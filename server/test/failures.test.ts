// How an action behaves when the model APIs fail (src/metaClient.ts has the one retry rule, src/retryChain.ts runs it), all through
// a create (POST /api/remix): what is retried and how often, what is never retried, which failures stop the action and name their
// provider, and that nothing a rejected answer streamed ever reaches the reader.
import { afterEach, describe, expect, it, vi } from "vitest";
import { roleConfig, type Env } from "../src/config";
import { act, frameOf, post, proseOf, type Frame } from "./api";
import { CHAPTER, SIX_EVENTS, fakeModels, type WriterReply } from "./fake-models";

const RETRIES = roleConfig({} as Env).retry.retries;
const IMAGE_RETRIES = roleConfig({} as Env).illustrator.retries;
const REMIX = { book: "frankenstein", request: "What if Victor kept his promise and built the companion?" };

const remix = (extra: Record<string, unknown> = {}) => act("/api/remix", { ...REMIX, ...extra });
const endOf = (frames: Frame[]) => frames.at(-1) as Extract<Frame, { t: "end" }>;
const count = (frames: Frame[], type: Frame["t"]) => frames.filter(frame => frame.t === type).length;
const failing = (status: number): WriterReply => ({ kind: "status", status });

afterEach(() => vi.restoreAllMocks());

describe("retried writer failures", () => {
	it.each([429, 503])("recovers from a writer %i: the chapter reaches the reader once", async status => {
		const models = fakeModels({ writer: [failing(status)] });
		const { frames } = await remix();

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		expect(models.writerCalls()).toHaveLength(2);
		expect(count(frames, "start")).toBe(2);
		expect(count(frames, "chapter")).toBe(1);
		expect(proseOf(frames)).toBe(CHAPTER);
	});

	it.each<[string, WriterReply]>([
		["plain prose instead of JSON", { kind: "text", text: "Once upon a time, the creature waited." }],
		["the chapter before its events", { kind: "text", text: JSON.stringify({ chapter: "Leaked prose that must stay hidden.", events: SIX_EVENTS }) }],
		["events that are not six sentences", { kind: "text", text: JSON.stringify({ events: ["Too few."], chapter: "Leaked prose that must stay hidden." }) }],
	])("retries a malformed answer (%s) and never shows its text", async (_, reply) => {
		const models = fakeModels({ writer: [reply] });
		const { frames } = await remix();

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		expect(models.writerCalls()).toHaveLength(2);
		expect(proseOf(frames)).toBe(CHAPTER);
		expect(proseOf(frames)).not.toMatch(/Once upon a time|Leaked prose/);
		expect(frameOf(frames, "chapter")?.chapter.chapter).toBe(CHAPTER);
	});

	it("retries a refusal", async () => {
		const models = fakeModels({ writer: [{ kind: "refusal", text: "I can't write that." }] });
		const { frames } = await remix();

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		expect(models.writerCalls()).toHaveLength(2);
		expect(proseOf(frames)).toBe(CHAPTER);
		expect(proseOf(frames)).not.toMatch(/can't write that/);
	});

	it(`gives up after ${RETRIES} retries and ends with the last error`, async () => {
		const script: WriterReply[] = [...Array.from({ length: RETRIES }, () => failing(503)), failing(429)];
		const models = fakeModels({ writer: script });
		const { frames } = await remix();

		const end = endOf(frames);
		expect(end).toMatchObject({ t: "end", status: "error", error: { stage: "writing" } });
		expect(end.error?.message).toMatch(/rate_limited/);
		expect(end.error).not.toHaveProperty("provider");
		expect(end.error).not.toHaveProperty("showcase");
		expect(models.writerCalls()).toHaveLength(RETRIES + 1);
		expect(frameOf(frames, "chapter")).toBeUndefined();
		expect(proseOf(frames)).toBe("");
	});
});

describe("writer failures that are not retried", () => {
	it("does not retry a 400", async () => {
		const models = fakeModels({ writer: [failing(400)] });
		const { frames } = await remix();

		expect(endOf(frames)).toMatchObject({ t: "end", status: "error", error: { stage: "writing", message: expect.stringMatching(/400/) } });
		expect(endOf(frames).error).not.toHaveProperty("provider");
		expect(models.writerCalls()).toHaveLength(1);
	});

	it.each([401, 402, 403])("stops the action on a Meta %i, in the showcase state", async status => {
		const models = fakeModels({ writer: [failing(status)] });
		const { frames } = await remix();

		expect(endOf(frames)).toMatchObject({ t: "end", status: "error", error: { stage: "writing", provider: "meta", showcase: true } });
		expect(models.writerCalls()).toHaveLength(1);
		const writerAt = models.calls.findIndex(call => call.path.endsWith("/responses"));
		expect(models.calls.slice(writerAt + 1)).toEqual([]);
		expect(frameOf(frames, "chapter")).toBeUndefined();
	});

	it("stops a Fast-mode action on a Baseten 401, without the showcase", async () => {
		const models = fakeModels({ writer: [failing(401)] });
		const { frames } = await remix({ fast: true });

		const end = endOf(frames);
		expect(end).toMatchObject({ t: "end", status: "error", error: { stage: "writing", provider: "baseten" } });
		expect(end.error).not.toHaveProperty("showcase");
		expect(models.writerCalls()).toHaveLength(1);
		expect(models.writerCalls()[0]!.host).toBe("baseten.fake");
	});
});

describe("the visitor leaves", () => {
	it("cuts the running writer call within seconds and sends no retry", async () => {
		const models = fakeModels({ writer: [{ kind: "hang" }] });
		const response = await post("/api/remix", REMIX);
		const reader = response.body!.getReader();
		void (async () => { while (!(await reader.read()).done); })().catch(() => {}); // the page reads the stream as it comes
		await vi.waitFor(() => expect(models.writerCalls()).toHaveLength(1), { timeout: 5000 });
		expect(models.writerCalls()[0]!.aborted).toBe(false);

		await reader.cancel(); // the visitor closed the tab
		await vi.waitFor(() => expect(models.writerCalls()[0]!.aborted).toBe(true), { timeout: 5000, interval: 100 });
		await new Promise(resolve => setTimeout(resolve, 1500));
		expect(models.writerCalls()).toHaveLength(1);
	}, 15_000);
});

describe("picture failures", () => {
	it("retries a comic that Muse Image refused for content policy, and keeps both pictures", async () => {
		const models = fakeModels({ images: [{ kind: "picture" }, { kind: "status", status: 400, code: "content_policy_violation" }] });
		const { frames } = await remix();

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		expect(models.imageCalls()).toHaveLength(3);
		expect(frames.filter(frame => frame.t === "image").map(frame => (frame as { id: string }).id).sort()).toEqual(["comic", "cover"]);
	});

	it("keeps trying a refused comic past the writer's retry count (pictures have their own, IMAGE_RETRIES)", async () => {
		const refusals = Array.from({ length: IMAGE_RETRIES }, () => ({ kind: "status" as const, status: 400, code: "content_policy_violation" }));
		expect(IMAGE_RETRIES).toBeGreaterThan(RETRIES);
		const models = fakeModels({ images: [{ kind: "picture" }, ...refusals] });
		const { frames } = await remix();

		expect(endOf(frames)).toEqual({ t: "end", status: "ready" });
		expect(models.imageCalls()).toHaveLength(2 + IMAGE_RETRIES); // the cover, the refusals, the comic that passed
	});

	it("keeps the chapter when the comic gets any other 400 (not retried)", async () => {
		const models = fakeModels({ images: [{ kind: "picture" }, { kind: "status", status: 400 }] });
		const { frames } = await remix();

		expect(endOf(frames)).toMatchObject({ t: "end", status: "error", error: { stage: "images", message: expect.stringMatching(/content_policy/) } });
		expect(endOf(frames).error).not.toHaveProperty("provider");
		expect(models.imageCalls().map(call => call.body.prompt)).toEqual([expect.stringMatching(/book cover/i), expect.stringMatching(/comic/i)]);
		expect(frameOf(frames, "chapter")?.chapter.chapter).toBe(CHAPTER);
		expect(frameOf(frames, "version")?.token).toEqual(expect.any(String));
		expect(proseOf(frames)).toBe(CHAPTER);
		expect(frames.filter(frame => frame.t === "image").map(frame => (frame as { id: string }).id)).toEqual(["cover"]);
	});
});
