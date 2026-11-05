// The API's front door: health, request validation, who may start work, and the guards that keep a misconfigured Worker from
// sending anything. None of these may reach a model.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { MODEL_PROFILE } from "../src/config";
import { ORIGIN, decode, get, post } from "./api";
import { fakeModels } from "./fake-models";

const BOOK = "frankenstein";
const REQUEST = "What if Victor kept his promise and built the companion?";

let models: ReturnType<typeof fakeModels>;
beforeEach(() => { models = fakeModels(); });
afterEach(() => {
	expect(models.calls, "no model call is sent").toHaveLength(0);
	vi.restoreAllMocks();
});

// The Worker with a changed environment (a misconfiguration), called the way the runtime calls it.
async function withEnv(overrides: Record<string, string | undefined>, request: Request) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, { ...env, ...overrides }, ctx);
	const body = response.headers.get("content-type")?.includes("octet-stream") ? decode(new Uint8Array(await response.arrayBuffer())) : await response.json();
	await waitOnExecutionContext(ctx);
	return { status: response.status, body };
}

describe("health", () => {
	it("reports the service, its models and its budgets without calling a model", async () => {
		const response = await get("/api/health");
		expect(response.status).toBe(200);
		const health = await response.json() as Record<string, any>;
		expect(health).toMatchObject({ ok: true, service: "novelspell-remix", mock: false, models: MODEL_PROFILE });
		expect(health.books).toBeGreaterThan(0);
		expect(health.budgets.meta).toMatchObject({ capUsd: Number((env as any).META_SPEND_CAP_USD), spentUsd: 0 });
		expect(health.budgets.baseten).toMatchObject({ capUsd: Number((env as any).BASETEN_SPEND_CAP_USD), spentUsd: 0 });
	});
});

describe("request validation", () => {
	it.each([
		["a body that is not JSON", "not json", "bad_body"],
		["a JSON array", "[]", "bad_body"],
		["an unknown book", { book: "no-such-book", request: REQUEST }, "bad_book"],
		["a request that is too short", { book: BOOK, request: "Hi" }, "bad_request"],
		["a request that is too long", { book: BOOK, request: "x".repeat(2001) }, "bad_request"],
		["a thinking level that does not exist", { book: BOOK, request: REQUEST, thinking: "max" }, "bad_thinking"],
	])("refuses %s with 400 %s", async (_name, body, code) => {
		const response = await post("/api/remix", body);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code } });
	});

	it("refuses a revise without a valid token or instruction", async () => {
		const response = await post("/api/remix/revise", { token: "nope", instruction: "Make it hopeful." });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "bad_token" } });
	});

	it("refuses a body over the size limit before reading it", async () => {
		const response = await post("/api/remix", JSON.stringify({ book: BOOK, request: REQUEST, pad: "x".repeat(400 * 1024) }));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "bad_body" } });
	});

	it("answers 404 for an unknown route", async () => {
		const response = await get("/api/nothing-here");
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: { code: "no_route" } });
	});
});

describe("who may start work", () => {
	it("refuses an action posted from another site", async () => {
		const response = await post("/api/remix", { book: BOOK, request: REQUEST }, { origin: "https://elsewhere.example" });
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ error: { code: "cross_origin" } });
	});

	it("refuses a cross-site browser request that sends no Origin", async () => {
		const response = await post("/api/remix", { book: BOOK, request: REQUEST }, { "sec-fetch-site": "cross-site" });
		expect(response.status).toBe(403);
	});

	it("allows the studio's origin through CORS and no other", async () => {
		const preflight = (origin: string) => worker.fetch(new Request(`${ORIGIN}/api/remix`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } }), env);
		expect((await preflight(ORIGIN)).headers.get("access-control-allow-origin")).toBe(ORIGIN);
		expect((await preflight("https://elsewhere.example")).headers.get("access-control-allow-origin")).toBeNull();
	});
});

describe("misconfiguration guards", () => {
	it("answers 503 when the version secret is missing", async () => {
		const { status, body } = await withEnv({ VERSION_SECRET: undefined }, new Request(`${ORIGIN}/api/remix`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ book: BOOK, request: REQUEST }) }));
		expect(status).toBe(503);
		expect(body).toMatchObject({ error: { code: "unavailable" } });
	});

	it("never sends a call in the free mock mode unless the fake is on this machine", async () => {
		const { body } = await withEnv({ MOCK: "1", META_BASE_URL: "https://meta.fake/v1" }, new Request(`${ORIGIN}/api/remix`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ book: BOOK, request: REQUEST }) }));
		expect((body as Array<{ t: string }>).at(-1)).toMatchObject({ t: "end", status: "error", error: { code: "mock_not_local" } });
	});

	it("sends nothing to Meta when its key is not set", async () => {
		const { body } = await withEnv({ META_MODEL_API_KEY: undefined }, new Request(`${ORIGIN}/api/remix`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ book: BOOK, request: REQUEST }) }));
		expect((body as Array<{ t: string }>).at(-1)).toMatchObject({ t: "end", status: "error", error: { code: "meta_unconfigured" } });
	});
});
