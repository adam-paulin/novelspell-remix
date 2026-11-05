// How much one client may start (src/clientLimits.ts): the per-minute rate limiter and the per-day count of model actions. A refused
// action is a 429 before any model call; other clients are not affected; shares do not count against the daily limit.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { ORIGIN } from "./api";
import { fakeModels } from "./fake-models";

const CREATE = { book: "frankenstein", request: "What if Victor kept his promise and built the companion?" };
const testEnv = env as unknown as Record<string, unknown> & { DB: D1Database };

let models: ReturnType<typeof fakeModels>;
beforeEach(async () => {
	models = fakeModels();
	await testEnv.DB.prepare("DELETE FROM client_actions").run();
});
afterEach(() => vi.restoreAllMocks());

// One request from `ip` to the Worker with these settings, read to its end.
async function send(path: string, body: unknown, ip: string, overrides: Record<string, unknown> = {}) {
	const ctx = createExecutionContext();
	const request = new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });
	const response = await worker.fetch(request, { ...env, ...overrides }, ctx);
	const text = await response.text();
	await waitOnExecutionContext(ctx);
	return { status: response.status, retryAfter: response.headers.get("retry-after"), json: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
}

describe("per-minute rate limit", () => {
	it("refuses with 429 rate_limited and sends nothing once the limiter says no", async () => {
		const limiter = { limit: vi.fn(async () => ({ success: false })) };
		const { status, retryAfter, json } = await send("/api/remix", CREATE, "203.0.113.7", { ACTION_LIMITER: limiter });

		expect(status).toBe(429);
		expect(json).toMatchObject({ error: { code: "rate_limited", retryable: true } });
		expect(Number(retryAfter)).toBeGreaterThan(0);
		expect(models.calls).toHaveLength(0);
	});

	it("keys the limit by a hash of the client, never its raw address", async () => {
		const limiter = { limit: vi.fn(async () => ({ success: true })) };
		await send("/api/remix", CREATE, "203.0.113.7", { ACTION_LIMITER: limiter });
		await send("/api/remix", CREATE, "198.51.100.4", { ACTION_LIMITER: limiter });

		const keys = (limiter.limit.mock.calls as unknown as [{ key: string }][]).map(([options]) => options.key);
		expect(keys).toHaveLength(2); // one check per action
		const [first, second] = keys;
		expect(first).not.toContain("203.0.113.7");
		expect(first).not.toBe(second);
	});

	it("lets the action through when the limiter itself fails", async () => {
		const limiter = { limit: vi.fn(async () => { throw new Error("limiter down"); }) };
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { status } = await send("/api/remix", CREATE, "203.0.113.7", { ACTION_LIMITER: limiter });
		expect(status).toBe(200);
	});
});

describe("daily limit", () => {
	it("refuses a client's model actions past ACTION_DAILY_LIMIT, until tomorrow", async () => {
		const settings = { ACTION_DAILY_LIMIT: "2" };
		expect((await send("/api/remix", CREATE, "203.0.113.7", settings)).status).toBe(200);
		expect((await send("/api/remix", CREATE, "203.0.113.7", settings)).status).toBe(200);
		const writes = models.writerCalls().length;

		const refused = await send("/api/remix", CREATE, "203.0.113.7", settings);
		expect(refused.status).toBe(429);
		expect(refused.json).toMatchObject({ error: { code: "daily_limit" } });
		expect(Number(refused.retryAfter)).toBeGreaterThan(0);
		expect(Number(refused.retryAfter)).toBeLessThanOrEqual(24 * 3600);
		expect(models.writerCalls()).toHaveLength(writes);
	});

	it("counts each client on its own", async () => {
		const settings = { ACTION_DAILY_LIMIT: "1" };
		expect((await send("/api/remix", CREATE, "203.0.113.7", settings)).status).toBe(200);
		expect((await send("/api/remix", CREATE, "203.0.113.7", settings)).status).toBe(429);
		expect((await send("/api/remix", CREATE, "198.51.100.4", settings)).status).toBe(200);
	});

	it("stores no raw address", async () => {
		await send("/api/remix", CREATE, "203.0.113.7", { ACTION_DAILY_LIMIT: "5" });
		const { results } = await testEnv.DB.prepare("SELECT client FROM client_actions").all<{ client: string }>();
		expect(results).toHaveLength(1);
		expect(results[0]!.client).not.toContain("203.0.113");
	});

	it("does not count when no daily limit is set", async () => {
		await send("/api/remix", CREATE, "203.0.113.7", { ACTION_DAILY_LIMIT: "" });
		const { results } = await testEnv.DB.prepare("SELECT client FROM client_actions").all();
		expect(results).toHaveLength(0);
	});
});
