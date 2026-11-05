// The writer's answer gate (src/answerStream.ts): valid answers decode to exactly what JSON.parse gives under any chunking, and a
// malformed opening throws AnswerFormatError at its first wrong character, before any prose reaches the reader.
import { describe, expect, it } from "vitest";
import { AnswerFormatError, answerStream } from "../src/answerStream";
import { PROMPTS } from "../src/prompts";

const EVENTS = PROMPTS.writer.output.schema.shape.events;

const six = ["A falls.", "B \"rises\".", "C\nturns.", "D é 😀  .", "E.", "F."];
const chapter = "Line one.\n\n\"Hi,\" she said \\ — 😀𝄞 é\u0000x\ttab.";
const good = JSON.stringify({ events: six, chapter });
const letters = ["a", "b", "c", "d", "e", "f"];
const withChapter = (raw: string) => `{"events":${JSON.stringify(letters)},"chapter":"${raw}"}`;

type Chunker = (text: string) => string[];

const whole: Chunker = text => [text];
/** One UTF-16 unit at a time: splits surrogate pairs and escape sequences. */
const chars: Chunker = text => text.split("");
/** Pieces of 1-9 units from a fixed-seed generator, so every run splits the same way. */
const seeded = (seed: number): Chunker => text => {
	let state = seed;
	const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
	const out: string[] = [];
	for (let i = 0; i < text.length;) {
		const n = 1 + Math.floor(next() * 9);
		out.push(text.slice(i, i + n));
		i += n;
	}
	return out;
};
const random = seeded(7);

/** Feeds `text` through the gate and records what came out, and when. */
function feed(text: string, chunk: Chunker = whole) {
	const gate = answerStream(EVENTS);
	let fed = 0;
	let eventsAt: number | undefined;
	let firstProseAt: number | undefined;
	let prose = "";
	let error: unknown;
	try {
		for (const piece of chunk(text)) {
			const out = gate.push(piece);
			fed += piece.length;
			if (out.events) eventsAt ??= fed;
			if (out.prose) {
				firstProseAt ??= fed;
				prose += out.prose;
			}
		}
	} catch (caught) {
		error = caught;
	}
	return { error, prose, eventsAt, firstProseAt, events: gate.events, chapter: gate.chapter, closed: gate.closed };
}

describe("valid answers", () => {
	it.each([
		["whole", whole],
		["one character at a time", chars],
		["in random chunks", random],
	])("decodes the chapter exactly as JSON.parse does when fed %s", (_name, chunk) => {
		const result = feed(good, chunk);
		expect(result.error).toBeUndefined();
		expect(result.events).toEqual(six);
		expect(result.chapter).toBe(chapter);
		expect(result.prose).toBe(result.chapter);
		expect(result.closed).toBe(true);
	});

	it("accepts a pretty-printed answer", () => {
		const result = feed(JSON.stringify({ events: six, chapter }, null, 2), chars);
		expect(result.error).toBeUndefined();
		expect(result.chapter).toBe(chapter);
		expect(result.closed).toBe(true);
	});

	it.each([
		["a ```json fence", "```json\n" + good + "\n```", random],
		["a bare ``` fence", "```\n" + good + "\n```", whole],
		["a ```json fence with CRLF line ends", "```json\r\n" + good + "\r\n```", whole],
		["leading whitespace", "\n  " + good, whole],
	])("tolerates %s before the object", (_name, text, chunk) => {
		const result = feed(text, chunk);
		expect(result.error).toBeUndefined();
		expect(result.chapter).toBe(chapter);
	});

	it.each([
		["an echoed closing tag", good + "\n</RESPONSE>"],
		["another key after the chapter", good.slice(0, -1) + ',"mood":"dark"}'],
	])("ignores %s after the chapter", (_name, text) => {
		const result = feed(text);
		expect(result.error).toBeUndefined();
		expect(result.chapter).toBe(chapter);
		expect(result.closed).toBe(true);
	});

	it("keeps the prose of a cut answer but does not report it closed", () => {
		const result = feed(good.slice(0, -10));
		expect(result.error).toBeUndefined();
		expect(result.closed).toBe(false);
		expect(chapter.startsWith(result.chapter)).toBe(true);
	});

	it("accepts \\u-escaped events", () => {
		const result = feed('{"events":["\\u0041 a","b","c","d","e","f"],"chapter":"x"}');
		expect(result.error).toBeUndefined();
		expect(result.events?.[0]).toBe("A a");
		expect(result.chapter).toBe("x");
	});

	it("lets a blank chapter through (rejecting it is the caller's call)", () => {
		const result = feed(JSON.stringify({ events: six, chapter: "  " }));
		expect(result.error).toBeUndefined();
		expect(result.chapter).toBe("  ");
	});
});

describe("escapes in the chapter", () => {
	it.each([
		["a surrogate pair split across two \\u escapes", "\\ud83d\\ude00!", "😀!"],
		["a lone surrogate, replaced", "x\\ud800y", "x�y"],
		["a valid \\u escape", "\\u00e9!", "é!"],
	])("decodes %s one character at a time", (_name, raw, expected) => {
		const result = feed(withChapter(raw), chars);
		expect(result.error).toBeUndefined();
		expect(result.chapter).toBe(expected);
	});

	it("replaces a malformed \\u escape and still sees the closing quote", () => {
		const result = feed(withChapter("ab\\u00") + ',"x":"y"}', chars);
		expect(result.error).toBeUndefined();
		expect(result.chapter).toBe("ab�");
		expect(result.closed).toBe(true);
	});

	it("holds a raw high surrogate until its pair arrives in the next chunk", () => {
		const text = withChapter("😀");
		const split = text.indexOf("😀") + 1; // between the two halves of the pair
		const gate = answerStream(EVENTS);
		expect(gate.push(text.slice(0, split)).prose).toBe("");
		expect(gate.push(text.slice(split)).prose).toBe("😀");
		expect(gate.chapter).toBe("😀");
	});
});

describe("malformed openings", () => {
	it.each([
		["prose instead of JSON", "Once upon a time", /does not open with a JSON object/],
		["the chapter before the events", JSON.stringify({ chapter, events: six }), /another field where "events"/],
		["another key first", JSON.stringify({ summary: six, chapter }), /another field where "events"/],
		["a key that only starts like events", '{"eventsX":[]}', /"events"/],
		["5 events", JSON.stringify({ events: six.slice(0, 5), chapter }), /exactly 6/],
		["7 events", JSON.stringify({ events: [...six, "G."], chapter }), /exactly 6/],
		["a blank event", JSON.stringify({ events: [...six.slice(0, 5), "  "], chapter }), /exactly 6/],
		["an event that is not a string", '{"events":["a","b","c","d","e",6],"chapter":"x"}', /do not fit/],
		["events that are a string", '{"events":"a b c","chapter":"x"}', /not a list/],
		["events that are not valid JSON", '{"events":["a",,"b"],"chapter":"x"}', /not valid JSON/],
		["no chapter after the events", JSON.stringify({ events: six }), /no chapter/],
		["another key between events and chapter", JSON.stringify({ events: six, mood: "x", chapter }), /another field where "chapter"/],
		["a chapter that is not a string", '{"events":["a","b","c","d","e","f"],"chapter":["x"]}', /not text/],
		["events that never close", '{"events":["' + "x".repeat(20_000), /ran past \d+ characters/],
		["a fence followed by prose", "```\nOnce upon", /does not open with a JSON object/],
		["a fence with junk on its line", "```json {", /something other than a JSON object/],
	])("rejects %s", (_name, text, message) => {
		const result = feed(text);
		expect(result.error).toBeInstanceOf(AnswerFormatError);
		expect((result.error as Error).message).toMatch(message);
		expect(result.prose).toBe("");
	});

	it("fails before any prose leaks, whatever the chunking", () => {
		const result = feed("Hello" + "x".repeat(10_000), random);
		expect(result.error).toBeInstanceOf(AnswerFormatError);
		expect(result.firstProseAt).toBeUndefined();
		expect(result.chapter).toBe("");
	});

	it("cuts a wrong key at its first wrong character", () => {
		const gate = answerStream(EVENTS);
		gate.push("{");
		gate.push("\"");
		expect(() => gate.push("x")).toThrow(AnswerFormatError);
	});
});

describe("event reporting", () => {
	it("reports the events once, before any prose", () => {
		const gate = answerStream(EVENTS);
		let reports = 0;
		let proseBeforeEvents = false;
		for (const piece of chars(good)) {
			const out = gate.push(piece);
			if (out.events) {
				reports++;
				expect(out.events).toEqual(six);
			}
			if (out.prose && reports === 0) proseBeforeEvents = true;
		}
		expect(reports).toBe(1);
		expect(proseBeforeEvents).toBe(false);
	});
});
