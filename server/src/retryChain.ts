// The retry loop both roles run their calls through: up to `retries` more tries, a wait (exponential backoff with jitter that honours
// Retry-After) only after an HTTP error, the stage time budget, and a per-attempt log that rides on the final error.
import { RoleError, type Attempt } from "./errors";
import type { RetrySettings } from "./config";

const sleep = (ms: number) => (ms > 0 ? new Promise<void>(resolve => setTimeout(resolve, ms)) : Promise.resolve());

/** The wait before retry number `attempt` (0-based): half-to-full jitter under an exponential ceiling, at least Retry-After (capped). */
export function backoffMs(retry: RetrySettings, attempt: number, retryAfterMs: number | null | undefined): number {
	const ceiling = Math.min(retry.maxMs, retry.baseMs * 2 ** attempt);
	const jittered = ceiling / 2 + Math.random() * (ceiling / 2);
	return Math.round(Math.max(jittered, Math.min(retryAfterMs ?? 0, retry.maxRetryAfterMs)));
}

export interface ChainResult<T> {
	value: T;
	provider: string;
	attempts: Attempt[];
}

/**
 * Runs `call(provider, attemptNumber)` down the provider chain, `retries` more tries per provider after its first.
 * Throws the error itself (with `attempts` and `provider`) when it is neither retryable nor allows failover, or
 * "all_providers_failed" once the chain is used up. The chain is a list for clarity, though this service only has Meta.
 */
export async function runChain<T>({ providers, retries, retry, deadline, call }: { providers: readonly string[]; retries: number; retry: RetrySettings; deadline: number; call: (provider: string, n: number) => Promise<T> }): Promise<ChainResult<T>> {
	const attempts: Attempt[] = [];
	let n = 0;
	let last: RoleError | null = null;
	// The action's shared stop (halted()) is rethrown by every later chain: it keeps the provider and attempts it already carries.
	const stop = <E extends { provider?: string | null; attempts?: Attempt[] }>(error: E, extra: { provider: string | null }) => Object.assign(error, { attempts: error.attempts ?? attempts, provider: error.provider ?? extra.provider });
	for (const provider of providers) {
		const limit = retries;
		for (let tries = 0; ; tries++) {
			if (Date.now() >= deadline) throw stop(new RoleError("stage_budget_exceeded", `The stage's time budget ran out${last ? ` (last error: ${last.code})` : ""}.`), { provider });
			const started = Date.now();
			n += 1;
			try {
				const value = await call(provider, n);
				attempts.push({ provider, n, ms: Date.now() - started, outcome: "ok" });
				return { value, provider, attempts };
			} catch (error) {
				if (!(error instanceof RoleError)) {
					// An unexpected exception (or a plain stop record) is not classified, but its attempt is still logged.
					attempts.push({ provider, n, ms: Date.now() - started, outcome: "unexpected_error", message: String((error as Error)?.message ?? error).slice(0, 200) });
					throw error !== null && typeof error === "object" ? stop(error, { provider }) : error;
				}
				last = error;
				attempts.push({ provider, n, ms: Date.now() - started, outcome: error.code, ...(error.status ? { status: error.status } : {}), ...(error.usage ? { usage: error.usage } : {}), ...(Number.isFinite(error.costUsd) ? { costUsd: error.costUsd } : {}), message: error.message.slice(0, 200) });
				if (!error.retryable && !error.failover) throw stop(error, { provider });
				if (!error.retryable || tries >= limit) break;
				// A 429 or 5xx means the provider is busy: wait. Anything else (a bad answer, a cut stream, a timeout) is retried at once.
				if (error.status) await sleep(Math.min(backoffMs(retry, tries, error.retryAfterMs), Math.max(deadline - Date.now(), 0)));
			}
		}
	}
	throw stop(new RoleError("all_providers_failed", `Every provider failed (${providers.join(", ")}); last: ${last?.code ?? "none"}: ${last?.message ?? ""}`.slice(0, 500)), { provider: null });
}
