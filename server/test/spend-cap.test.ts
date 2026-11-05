// The per-provider spend ceilings (src/spendCap.ts): every model call reserves its estimate in its provider's `spend_ledger` row
// before it is sent and books its actual cost after. A provider at its cap stops the action before anything is sent, and the Meta
// and Baseten budgets never mix. The caps come from wrangler.jsonc (META_SPEND_CAP_USD, BASETEN_SPEND_CAP_USD).
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ILLUSTRATOR_MODEL, WRITERS } from "../src/config";
import { DEFAULT_THINKING } from "../src/prompts";
import { act, get, proseOf, type Frame } from "./api";
import { CHAPTER, fakeModels } from "./fake-models";

const { DB, META_SPEND_CAP_USD, BASETEN_SPEND_CAP_USD } = env as unknown as { DB: D1Database; META_SPEND_CAP_USD: string; BASETEN_SPEND_CAP_USD: string };
const CAP = { meta: Number(META_SPEND_CAP_USD), baseten: Number(BASETEN_SPEND_CAP_USD) };
const REMIX = { book: "frankenstein", request: "What if Victor kept his promise and built the companion?" };

type Provider = keyof typeof CAP;
type Row = { usd: number; calls: number };

const remix = (extra: Record<string, unknown> = {}) => act("/api/remix", { ...REMIX, ...extra });
const endOf = (frames: Frame[]) => frames.at(-1) as Extract<Frame, { t: "end" }>;
const seed = (provider: Provider, usd: number, calls = 0) => DB.prepare("INSERT INTO spend_ledger (provider, usd, calls) VALUES (?1, ?2, ?3)").bind(provider, usd, calls).run();
const ledger = async (provider: Provider): Promise<Row> => (await DB.prepare("SELECT usd, calls FROM spend_ledger WHERE provider = ?1").bind(provider).first<Row>()) ?? { usd: 0, calls: 0 };

// D1 storage persists across the tests of one file (setup.ts migrates it once per file), so every test starts from an empty ledger.
beforeEach(async () => {
	await DB.prepare("DELETE FROM spend_ledger").run();
});
afterEach(() => vi.restoreAllMocks());

describe("the Meta ceiling", () => {
	it("ends a create with spend_cap_reached before any model call when no reservation fits", async () => {
		// A tenth of a cent under the cap: less than the cheapest call (one picture) costs.
		await seed("meta", CAP.meta - ILLUSTRATOR_MODEL.perImage / 10, 7);
		const models = fakeModels();
		const { frames } = await remix();

		expect(endOf(frames)).toMatchObject({ t: "end", status: "error", error: { code: "spend_cap_reached", stage: "writing", provider: "meta", showcase: true } });
		expect(endOf(frames).error?.message).toMatch(/budget/i);
		expect(models.calls).toEqual([]);
		expect(await ledger("meta")).toEqual({ usd: CAP.meta - ILLUSTRATOR_MODEL.perImage / 10, calls: 7 });
	});

	it("books a create's actual cost: the writer's usage at list price plus each picture", async () => {
		const usage = { input: 5200, output: 2400 };
		const models = fakeModels({ writer: [{ kind: "answer", usage }] });
		const { frames } = await remix();

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		expect(proseOf(frames)).toBe(CHAPTER);
		const { price } = WRITERS.normal[DEFAULT_THINKING];
		const pictures = models.imageCalls().length;
		expect(pictures).toBe(2); // the cover and the comic
		const expected = (usage.input * price.input + usage.output * price.output) / 1e6 + pictures * ILLUSTRATOR_MODEL.perImage;
		const row = await ledger("meta");
		expect(row.usd).toBeGreaterThan(0);
		expect(row.usd).toBeCloseTo(expected, 9);
		expect(row.calls).toBe(models.calls.length);
	});

	it("adds to the running total instead of replacing it", async () => {
		await seed("meta", 12.5, 40);
		const models = fakeModels();
		const { frames } = await remix();

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		const row = await ledger("meta");
		expect(row.usd).toBeGreaterThan(12.5);
		expect(row.calls).toBe(40 + models.calls.length);
	});
});

describe("the Baseten ceiling", () => {
	it("stops Fast mode at its cap without the showcase, and sends Baseten nothing", async () => {
		await seed("baseten", CAP.baseten);
		const models = fakeModels();
		const { frames } = await remix({ fast: true });

		const end = endOf(frames);
		expect(end).toMatchObject({ t: "end", status: "error", error: { code: "spend_cap_reached", stage: "writing", provider: "baseten" } });
		expect(end.error).not.toHaveProperty("showcase");
		expect(models.calls.filter(call => call.host === "baseten.fake")).toEqual([]);
		expect(models.writerCalls()).toEqual([]);
		expect((await ledger("baseten")).usd).toBe(CAP.baseten);
	});

	it("leaves normal mode working while Baseten is at its cap", async () => {
		await seed("baseten", CAP.baseten);
		const models = fakeModels();
		const { frames } = await remix();

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		expect(models.writerCalls().map(call => call.host)).toEqual(["meta.fake"]);
		expect((await ledger("meta")).usd).toBeGreaterThan(0);
		expect(await ledger("baseten")).toEqual({ usd: CAP.baseten, calls: 0 });
	});

	it("books a Fast-mode writer call under Baseten and its pictures under Meta", async () => {
		const models = fakeModels();
		const { frames } = await remix({ fast: true });

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		expect(models.writerCalls().map(call => call.host)).toEqual(["baseten.fake"]);
		expect(await ledger("baseten")).toMatchObject({ calls: 1, usd: expect.any(Number) });
		expect((await ledger("baseten")).usd).toBeGreaterThan(0);
		const meta = await ledger("meta");
		expect(meta.calls).toBe(models.imageCalls().length);
		expect(meta.usd).toBeCloseTo(models.imageCalls().length * ILLUSTRATOR_MODEL.perImage, 9);
	});
});

describe("/api/health", () => {
	it("reports each provider's cap and spend without calling a model", async () => {
		await seed("meta", 12.5, 40);
		const models = fakeModels();
		const response = await get("/api/health");

		expect(response.status).toBe(200);
		expect((await response.json() as { budgets: unknown }).budgets).toEqual({
			meta: { capUsd: CAP.meta, spentUsd: 12.5 },
			baseten: { capUsd: CAP.baseten, spentUsd: 0 },
		});
		expect(models.calls).toEqual([]);
	});
});
