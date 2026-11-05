// The three actions end to end, as the studio page drives them: create a remix, revise it, redraw its comic. The Worker runs for
// real (routes, pipeline, D1); only the model APIs are faked (fake-models.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookMap, forkChapter } from "../src/books";
import { ILLUSTRATOR_MODEL, WRITERS } from "../src/config";
import { DEFAULT_THINKING, THINKING_LEVELS } from "../src/prompts";
import { act, frameOf, post, proseOf, type Frame } from "./api";
import { CHAPTER, SIX_EVENTS, fakeModels, type ModelCall } from "./fake-models";

const BOOK = "frankenstein";
const REQUEST = "What if Victor kept his promise and built the companion?";

afterEach(() => vi.restoreAllMocks());

const types = (frames: Frame[]) => frames.map(frame => frame.t);
// A writer request: INFO (the book and its chapter cut at the fork) is in `instructions`, DATA (the reader's input) in the one user message.
const dataOf = (call: ModelCall | undefined) => JSON.parse(/<DATA>\n([\s\S]*?)\n<\/DATA>/.exec(String(call?.body.input?.[0]?.content))![1]!);
const images = (frames: Frame[]) => frames.filter((frame): frame is Extract<Frame, { t: "image" }> => frame.t === "image");

async function created() {
	const { frames } = await act("/api/remix", { book: BOOK, request: REQUEST });
	const token = frameOf(frames, "version")?.token;
	if (!token) throw new Error(`The create did not finish: ${JSON.stringify(frames.at(-1))}`);
	return { frames, token };
}

describe("create", () => {
	it("streams the chapter, its events and both pictures, then ends ready", async () => {
		const models = fakeModels();
		const { status, frames } = await act("/api/remix", { book: BOOK, request: REQUEST });

		expect(status).toBe(200);
		expect(frames[0]).toMatchObject({ t: "accepted", version: 1, models: { writer: { provider: "meta", model: WRITERS.normal[DEFAULT_THINKING].model, effort: WRITERS.normal[DEFAULT_THINKING].effort }, illustrator: { provider: ILLUSTRATOR_MODEL.provider, model: ILLUSTRATOR_MODEL.model } } });
		expect(frames.at(-1)).toEqual({ t: "end", status: "ready" });
		expect(types(frames).filter(type => type === "end")).toHaveLength(1);

		expect(proseOf(frames)).toBe(CHAPTER);
		expect(frameOf(frames, "chapter")?.chapter).toMatchObject({ events: SIX_EVENTS, chapter: CHAPTER });
		expect(frameOf(frames, "version")).toMatchObject({ n: 1, token: expect.any(String) });

		expect(images(frames).map(image => image.id).sort()).toEqual(["comic", "cover"]);
		for (const image of images(frames)) {
			expect(image.mime).toBe("image/png");
			expect(image.bytes?.length).toBeGreaterThan(0);
			expect(image.sig).toEqual(expect.any(String));
		}
		expect(models.writerCalls()).toHaveLength(1);
		expect(models.imageCalls()).toHaveLength(2);
	});

	it("sends the configured key to Meta and draws the comic from the chapter's events", async () => {
		const models = fakeModels();
		await created();

		for (const call of models.calls) expect(call.authorization).toBe("Bearer test-meta-key");
		const prompts = models.imageCalls().map(call => JSON.stringify(call.body));
		const comic = prompts.find(prompt => SIX_EVENTS.every(event => prompt.includes(event)));
		expect(comic, "one picture prompt holds all six events").toBeDefined();
	});
});

describe("what the writer reads (fork design)", () => {
	it("gets the book's chapter cut at the chosen turning point, and only the request as DATA", async () => {
		const point = bookMap(BOOK).divergencePoints![0]!;
		const fork = forkChapter(BOOK, point);
		const models = fakeModels();
		await act("/api/remix", { book: BOOK, request: REQUEST, divergenceId: point.id });

		const [call] = models.writerCalls();
		const instructions = String(call?.body.instructions);
		expect(instructions).toContain(JSON.stringify(fork.beforeFork.slice(-200)).slice(1, -1));
		expect(instructions).toContain(JSON.stringify(fork.afterFork.slice(0, 200)).slice(1, -1));
		expect(dataOf(call)).toEqual({ request: REQUEST });
	});

	it("gets the previous answer and the instruction on a revise", async () => {
		const models = fakeModels();
		const { token } = await created();
		await act("/api/remix/revise", { token, instruction: "Make the ending hopeful." });

		expect(dataOf(models.writerCalls()[1])).toEqual({ request: REQUEST, previous: { events: SIX_EVENTS, chapter: CHAPTER }, instruction: "Make the ending hopeful." });
	});
});

describe("thinking dial", () => {
	it("uses the default level when a request sends none", async () => {
		const models = fakeModels();
		await act("/api/remix", { book: BOOK, request: REQUEST });
		await act("/api/remix", { book: BOOK, request: REQUEST, fast: true });

		const [normal, fast] = models.writerCalls();
		expect(normal?.body).toMatchObject({ model: WRITERS.normal[DEFAULT_THINKING].model, reasoning: { effort: WRITERS.normal[DEFAULT_THINKING].effort } });
		expect(fast?.body).toMatchObject({ model: WRITERS.fast[DEFAULT_THINKING].model, reasoning: { effort: WRITERS.fast[DEFAULT_THINKING].effort } });
	});

	it.each(THINKING_LEVELS)("level %s sets the normal writer's effort", async level => {
		const models = fakeModels();
		const { frames } = await act("/api/remix", { book: BOOK, request: REQUEST, thinking: level });

		const entry = WRITERS.normal[level];
		expect(frames.at(-1)).toEqual({ t: "end", status: "ready" });
		expect(frameOf(frames, "accepted")?.models.writer).toEqual({ provider: entry.provider, model: entry.model, effort: entry.effort });
		expect(models.writerCalls()[0]?.body).toMatchObject({ model: entry.model, reasoning: { effort: entry.effort } });
	});

	it.each(THINKING_LEVELS)("level %s in Fast mode writes on Baseten with its effort", async level => {
		const models = fakeModels();
		const { frames } = await act("/api/remix", { book: BOOK, request: REQUEST, thinking: level, fast: true });

		const entry = WRITERS.fast[level];
		const [call] = models.writerCalls();
		expect(frames.at(-1)).toEqual({ t: "end", status: "ready" });
		expect(call?.host).toBe("baseten.fake");
		expect(call?.authorization).toBe("Bearer test-baseten-key");
		expect(call?.body).toMatchObject({ model: entry.model, reasoning: { effort: entry.effort } });
		// Pictures stay on Meta in every mode.
		expect(models.imageCalls().every(image => image.host === "meta.fake")).toBe(true);
	});
});

describe("revise", () => {
	it("rewrites the chapter from its token as version 2 and keeps the cover", async () => {
		const models = fakeModels();
		const { token } = await created();

		const revised = "The ending turns hopeful: the creatures build a home in the north.";
		models.restore();
		const again = fakeModels({ writer: [{ kind: "answer", chapter: revised }] });
		const { frames } = await act("/api/remix/revise", { token, instruction: "Make the ending hopeful." });

		expect(frames.at(-1)).toEqual({ t: "end", status: "ready" });
		expect(proseOf(frames)).toBe(revised);
		expect(frameOf(frames, "version")).toMatchObject({ n: 2, token: expect.any(String) });
		expect(frameOf(frames, "version")?.token).not.toBe(token);
		expect(JSON.stringify(again.writerCalls()[0]?.body)).toContain("Make the ending hopeful.");
		expect(images(frames).map(image => image.id)).toEqual(["comic"]);
	});

	it("refuses a token this service did not sign", async () => {
		const models = fakeModels();
		const { token } = await created();
		const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
		const before = models.calls.length;

		const response = await post("/api/remix/revise", { token: tampered, instruction: "Make the ending hopeful." });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "bad_token" } });
		expect(models.calls.length).toBe(before);
	});
});

describe("redraw", () => {
	it("draws the comic again without calling the writer", async () => {
		const models = fakeModels();
		const { token } = await created();
		const writes = models.writerCalls().length;

		const { frames } = await act("/api/remix/redraw", { token });
		expect(frames.at(-1)).toEqual({ t: "end", status: "ready" });
		expect(frameOf(frames, "accepted")?.models.writer).toBeUndefined();
		expect(images(frames).map(image => image.id)).toEqual(["comic"]);
		expect(models.writerCalls()).toHaveLength(writes);
	});

	it("draws the cover too when asked", async () => {
		fakeModels();
		const { token } = await created();
		const { frames } = await act("/api/remix/redraw", { token, cover: true });
		expect(images(frames).map(image => image.id).sort()).toEqual(["comic", "cover"]);
	});
});
