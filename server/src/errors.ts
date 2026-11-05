// Errors the writer and illustrator report, and the one "stop" rule of the service.

/** Token usage of one delivered writer answer (the Responses API `usage`, normalized). */
export interface Usage {
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cached_input_tokens: number;
	reasoning_tokens: number | null;
	calls: number;
}

/** One call in a retry chain, kept on the error that ends the chain. */
export interface Attempt {
	provider: string;
	n: number;
	ms: number;
	outcome: string;
	status?: number;
	usage?: Usage;
	costUsd?: number;
	message?: string;
}

/**
 * Anything that can stop an action or end a role call: a RoleError, or the plain record the pipeline builds from a writer
 * attempt's outcome. Every field is optional because both shapes flow through the same checks.
 */
export interface Failure {
	code?: string;
	message?: string;
	status?: number | null;
	provider?: string | null;
	attempts?: Attempt[];
	costUsd?: number;
	billed?: boolean;
	dispatched?: boolean;
}

/**
 * An error with a stable code.
 *   retryable  the same provider may be called again (up to RETRIES more times: metaClient.ts has the one rule)
 *   failover   once the retries are used up the chain may move on (provider-level failures only, never our own validation)
 */
export class RoleError extends Error implements Failure {
	code: string;
	retryable: boolean;
	failover: boolean;
	status: number | null;
	retryAfterMs: number | null;
	attempts?: Attempt[];
	provider?: string | null;
	usage?: Usage;
	costUsd?: number;
	billed?: boolean;
	dispatched?: boolean;

	constructor(code: string, message: string, { retryable = false, failover = false, status = null, retryAfterMs = null }: { retryable?: boolean; failover?: boolean; status?: number | null; retryAfterMs?: number | null } = {}) {
		super(message);
		this.code = code;
		this.retryable = retryable;
		this.failover = failover;
		this.status = status;
		this.retryAfterMs = retryAfterMs;
	}
}

/**
 * Provider answers that mean "stop everything for this action": a 401/402/403 on our own key for that provider (auth, billing,
 * forbidden). A provider's spend-cap refusal is a 402 too. A 400 (a content-moderation refusal, for example) never stops anything.
 * The stop names its provider: a Meta stop puts the studio in the showcase state; any other provider's stop only ends the action.
 */
export const STOP_STATUSES = [401, 402, 403];

/** This error or attempt record is a provider's 401/402/403. */
export const isProviderStop = (item: Failure | Attempt | null | undefined): boolean =>
	STOP_STATUSES.includes(item?.status ?? -1) && Boolean(item?.provider);

/** The error, or any attempt it carries, is a provider stop. */
export function isFatal(error: unknown): boolean {
	const failure = asFailure(error);
	return isProviderStop(failure) || (failure?.attempts ?? []).some(isProviderStop);
}

/** Reads any thrown value as a Failure (thrown values are `unknown` in TypeScript). */
export const asFailure = (error: unknown): Failure | null => (error !== null && typeof error === "object" ? (error as Failure) : null);

export const errorMessage = (error: unknown): string => String(asFailure(error)?.message ?? error);
