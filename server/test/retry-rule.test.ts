// The one retry rule (src/retryChain.ts runChain) and the stop rule it obeys (src/errors.ts isFatal / isProviderStop, src/metaClient.ts
// stopsChain): how often a failure is tried again, when it waits first, what is thrown at the end, and what stops the chain at once.
import { describe, expect, it } from "vitest";
import { roleConfig, type Env, type RetrySettings } from "../src/config";
import { RoleError, STOP_STATUSES, isFatal, isProviderStop } from "../src/errors";
import { stopsChain } from "../src/metaClient";
import { runChain } from "../src/retryChain";

const DEFAULT_RETRIES = roleConfig({} as Env).retry.retries;
const FAST: RetrySettings = { retries: DEFAULT_RETRIES, baseMs: 1, maxMs: 5, maxRetryAfterMs: 5 };
const later = (ms = 60_000) => Date.now() + ms;

const busy = () => new RoleError("http_503", "Service unavailable", { retryable: true, failover: true, status: 503 });
const badAnswer = () => new RoleError("bad_answer", "The answer did not fit", { retryable: true });
const refused = () => new RoleError("http_400", "Bad request", { status: 400 });

/** A fake provider call that plays `script` in order (an error is thrown, anything else returned) and remembers every call. */
function scripted<T>(script: Array<T | Error | (() => Error)>) {
	const calls: Array<{ provider: string; n: number; at: number }> = [];
	const call = async (provider: string, n: number): Promise<T> => {
		calls.push({ provider, n, at: Date.now() });
		const step = script[Math.min(calls.length - 1, script.length - 1)];
		const value = typeof step === "function" ? (step as () => Error)() : step;
		if (value instanceof Error) throw value;
		return value as T;
	};
	return { call, calls };
}

/** Runs the chain and returns what it threw (fails the test if it resolved). */
async function failure(promise: Promise<unknown>): Promise<RoleError> {
	try {
		await promise;
	} catch (error) {
		return error as RoleError;
	}
	throw new Error("expected the chain to throw");
}

const gaps = (calls: Array<{ at: number }>) => calls.slice(1).map((c, i) => c.at - calls[i]!.at);

describe("runChain", () => {
	it("returns the first success with its provider and attempt log", async () => {
		const { call, calls } = scripted([badAnswer, "chapter"]);
		const result = await runChain({ providers: ["meta"], retries: DEFAULT_RETRIES, retry: FAST, deadline: later(), call });
		expect(result.value).toBe("chapter");
		expect(result.provider).toBe("meta");
		expect(calls.map(c => c.n)).toEqual([1, 2]);
		expect(result.attempts.map(a => a.outcome)).toEqual(["bad_answer", "ok"]);
	});

	it(`tries a retryable failure ${DEFAULT_RETRIES} more times by default (${DEFAULT_RETRIES + 1} calls in all)`, async () => {
		expect(DEFAULT_RETRIES).toBe(3);
		const { call, calls } = scripted([badAnswer]);
		const error = await failure(runChain({ providers: ["meta"], retries: DEFAULT_RETRIES, retry: FAST, deadline: later(), call }));
		expect(calls).toHaveLength(DEFAULT_RETRIES + 1);
		expect(error.attempts).toHaveLength(DEFAULT_RETRIES + 1);
	});

	it.each([0, 1, 5])("honours retries = %i", async retries => {
		const { call, calls } = scripted([busy]);
		await failure(runChain({ providers: ["meta"], retries, retry: FAST, deadline: later(), call }));
		expect(calls).toHaveLength(retries + 1);
	});

	it("succeeds on the last allowed try", async () => {
		const { call, calls } = scripted([busy, busy, busy, "ok"]);
		const result = await runChain({ providers: ["meta"], retries: 3, retry: FAST, deadline: later(), call });
		expect(result.value).toBe("ok");
		expect(calls).toHaveLength(4);
	});

	it("throws all_providers_failed naming the last error, with every attempt, once the retries run out", async () => {
		const { call } = scripted([badAnswer, badAnswer, busy]);
		const error = await failure(runChain({ providers: ["meta"], retries: 2, retry: FAST, deadline: later(), call }));
		expect(error).toBeInstanceOf(RoleError);
		expect(error.code).toBe("all_providers_failed");
		expect(error.message).toMatch(/last: http_503/);
		expect(error.attempts?.map(a => a.outcome)).toEqual(["bad_answer", "bad_answer", "http_503"]);
		expect(error.attempts?.at(-1)?.status).toBe(503);
	});

	it("does not retry a non-retryable failure and throws that error itself", async () => {
		const { call, calls } = scripted([refused]);
		const error = await failure(runChain({ providers: ["meta", "backup"], retries: 3, retry: FAST, deadline: later(), call }));
		expect(calls).toHaveLength(1);
		expect(error.code).toBe("http_400");
		expect(error.provider).toBe("meta");
		expect(error.attempts).toEqual([expect.objectContaining({ provider: "meta", n: 1, outcome: "http_400", status: 400 })]);
	});

	it("moves to the next provider once a failover-able failure has used its retries", async () => {
		const { call, calls } = scripted([busy, busy, "ok"]);
		const result = await runChain({ providers: ["meta", "backup"], retries: 1, retry: FAST, deadline: later(), call });
		expect(calls.map(c => c.provider)).toEqual(["meta", "meta", "backup"]);
		expect(result.provider).toBe("backup");
	});

	it("rethrows an unexpected exception without retrying, logging the attempt", async () => {
		const boom = new TypeError("boom");
		const { call, calls } = scripted([boom]);
		const error = await failure(runChain({ providers: ["meta"], retries: 3, retry: FAST, deadline: later(), call }));
		expect(error).toBe(boom);
		expect(calls).toHaveLength(1);
		expect(error.attempts).toEqual([expect.objectContaining({ outcome: "unexpected_error", message: "boom" })]);
	});

	describe("waiting between tries", () => {
		const slow: RetrySettings = { retries: 3, baseMs: 40, maxMs: 40, maxRetryAfterMs: 1_000 };

		it("waits before retrying a failure with an HTTP status (429/5xx)", async () => {
			const { call, calls } = scripted([() => new RoleError("http_429", "Too many requests", { retryable: true, status: 429 }), "ok"]);
			await runChain({ providers: ["meta"], retries: 3, retry: slow, deadline: later(), call });
			// Backoff is half-to-full jitter under the 40 ms ceiling.
			expect(gaps(calls)[0]).toBeGreaterThanOrEqual(19);
		});

		it("retries a failure without a status at once", async () => {
			const { call, calls } = scripted([badAnswer, badAnswer, "ok"]);
			await runChain({ providers: ["meta"], retries: 3, retry: slow, deadline: later(), call });
			for (const gap of gaps(calls)) expect(gap).toBeLessThan(19);
		});

		it("waits at least the error's Retry-After", async () => {
			const { call, calls } = scripted([() => new RoleError("http_429", "Slow down", { retryable: true, status: 429, retryAfterMs: 120 }), "ok"]);
			await runChain({ providers: ["meta"], retries: 3, retry: { ...slow, baseMs: 1, maxMs: 1 }, deadline: later(), call });
			expect(gaps(calls)[0]).toBeGreaterThanOrEqual(115);
		});

		it("caps Retry-After at maxRetryAfterMs", async () => {
			const { call, calls } = scripted([() => new RoleError("http_429", "Slow down", { retryable: true, status: 429, retryAfterMs: 60_000 }), "ok"]);
			await runChain({ providers: ["meta"], retries: 3, retry: { retries: 3, baseMs: 1, maxMs: 1, maxRetryAfterMs: 30 }, deadline: later(), call });
			expect(gaps(calls)[0]).toBeGreaterThanOrEqual(25);
			expect(gaps(calls)[0]).toBeLessThan(1_000);
		});
	});

	describe("the deadline", () => {
		it("makes no call once the deadline has passed", async () => {
			const { call, calls } = scripted(["ok"]);
			const error = await failure(runChain({ providers: ["meta"], retries: 3, retry: FAST, deadline: Date.now() - 1, call }));
			expect(calls).toHaveLength(0);
			expect(error.code).toBe("stage_budget_exceeded");
		});

		it("ends the retries when the deadline passes, naming the last error", async () => {
			const { call, calls } = scripted([busy]);
			const started = Date.now();
			const error = await failure(runChain({ providers: ["meta"], retries: 1_000, retry: { retries: 1_000, baseMs: 10, maxMs: 10, maxRetryAfterMs: 10 }, deadline: later(60), call }));
			expect(error.code).toBe("stage_budget_exceeded");
			expect(error.message).toMatch(/last error: http_503/);
			expect(calls.length).toBeGreaterThan(1);
			expect(calls.length).toBeLessThan(1_001);
			expect(Date.now() - started).toBeLessThan(1_000);
		});

		it("never sleeps past the deadline for a long Retry-After", async () => {
			const { call, calls } = scripted([() => new RoleError("http_429", "Slow down", { retryable: true, status: 429, retryAfterMs: 60_000 })]);
			const started = Date.now();
			const error = await failure(runChain({ providers: ["meta"], retries: 3, retry: { retries: 3, baseMs: 1, maxMs: 1, maxRetryAfterMs: 60_000 }, deadline: later(50), call }));
			expect(error.code).toBe("stage_budget_exceeded");
			expect(calls).toHaveLength(1);
			expect(Date.now() - started).toBeLessThan(1_000);
		});
	});

	describe("provider stops", () => {
		it.each(STOP_STATUSES)("stops the whole chain on a provider %i, with no further call", async status => {
			// The roles' call wrapper (src/roles.ts) passes every failure through stopsChain before the chain sees it.
			const { call, calls } = scripted<string>([() => new RoleError(`http_${status}`, "Refused", { retryable: true, failover: true, status })]);
			const fatal = (provider: string, n: number) => call(provider, n).catch(error => { throw stopsChain(error, provider); });
			const error = await failure(runChain({ providers: ["meta", "backup"], retries: 3, retry: FAST, deadline: later(), call: fatal }));
			expect(calls).toHaveLength(1);
			expect(error.code).toBe(`http_${status}`);
			expect(error.provider).toBe("meta");
			expect(isFatal(error)).toBe(true);
		});
	});
});

describe("stopsChain", () => {
	it.each(STOP_STATUSES)("makes a %i neither retryable nor failover-able", status => {
		const error = new RoleError(`http_${status}`, "Refused", { retryable: true, failover: true, status });
		expect(stopsChain(error, "meta")).toBe(error);
		expect(error.retryable).toBe(false);
		expect(error.failover).toBe(false);
	});

	it.each([400, 429, 500, 503])("leaves a %i as it was", status => {
		const error = new RoleError(`http_${status}`, "Failed", { retryable: true, failover: true, status });
		stopsChain(error, "meta");
		expect(error.retryable).toBe(true);
		expect(error.failover).toBe(true);
	});

	it("passes anything that is not a RoleError through untouched", () => {
		const error = Object.assign(new Error("odd"), { status: 401, retryable: true });
		expect(stopsChain(error, "meta")).toBe(error);
		expect(error.retryable).toBe(true);
	});
});

describe("isProviderStop", () => {
	it.each(STOP_STATUSES)("is true for a provider's %i", status => {
		expect(isProviderStop({ status, provider: "meta" })).toBe(true);
	});

	it.each([400, 404, 429, 500, 503])("is false for a provider's %i", status => {
		expect(isProviderStop({ status, provider: "meta" })).toBe(false);
	});

	it("is false for a 401 that names no provider", () => {
		expect(isProviderStop({ status: 401 })).toBe(false);
		expect(isProviderStop({ status: 401, provider: null })).toBe(false);
	});

	it("is false for nothing", () => {
		expect(isProviderStop(null)).toBe(false);
		expect(isProviderStop(undefined)).toBe(false);
	});
});

describe("isFatal", () => {
	it("is true when the error itself is a provider stop", () => {
		expect(isFatal({ code: "http_402", status: 402, provider: "meta" })).toBe(true);
	});

	it("is true when any attempt it carries is a provider stop", () => {
		const error = new RoleError("all_providers_failed", "Every provider failed");
		error.attempts = [
			{ provider: "meta", n: 1, ms: 5, outcome: "http_503", status: 503 },
			{ provider: "meta", n: 2, ms: 5, outcome: "http_403", status: 403 },
		];
		expect(isFatal(error)).toBe(true);
	});

	it("is false for retryable provider trouble", () => {
		const error = new RoleError("all_providers_failed", "Every provider failed");
		error.attempts = [{ provider: "meta", n: 1, ms: 5, outcome: "http_429", status: 429 }];
		expect(isFatal(error)).toBe(false);
	});

	it.each([null, undefined, "401", 401, new Error("plain")])("is false for %o", value => {
		expect(isFatal(value)).toBe(false);
	});
});
