// The writer's answer, read as it streams. Every text model (normal and Fast mode, create and revise) answers one JSON object that
// must open exactly like this, in this order:
//
//   {"events": [six non-blank strings], "chapter": "the prose..."
//
// The opening is the gate. Nothing reaches the page until it has passed: the events must arrive first, close, and fit their schema
// (the prompts' chapterAnswer.events) before the chapter's prose is released. The moment the opening goes wrong (prose instead of
// JSON, another key first, events that do not fit, no chapter after them) push() throws an AnswerFormatError, so the caller can cut
// the call and ask again before the reader has seen anything. A Markdown fence before the object is tolerated.
//
// After the gate there is nothing left to check but the prose itself: the chapter string is decoded (escapes, \uXXXX, surrogate
// pairs across chunk boundaries) and handed over in deltas. Whatever follows the chapter string (another key, an echoed tag) is
// ignored: the reader has the chapter, and rewriting it for a stray key would cost them a chapter they already read.
import type { z } from "zod";

export class AnswerFormatError extends Error {}

/** The most text the opening may take before its events close (six short events are about 1-2 KB). */
const OPENING_LIMIT = 16_384;
const ESCAPES: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;

type State = "open" | "fence" | "key" | "colon" | "events" | "comma" | "body" | "prose" | "done";

export function answerStream(eventsSchema: z.ZodType<string[]>) {
	let state: State = "open";
	let want = "events"; // the key the opening expects next
	let token = ""; // the key being read, or the raw events JSON being captured
	let inString = false, escaped = false, depth = 0, opened = 0;
	let hex: string | null = null, carry = "";
	let events: string[] | null = null;
	let chapter = "";
	const fail = (why: string) => new AnswerFormatError(`the answer ${why}`);

	return {
		/** The validated events, once the gate has passed. */
		get events() { return events; },
		/** All the prose so far. */
		get chapter() { return chapter; },
		/** True once the chapter string has closed. */
		get closed() { return state === "done"; },

		/** Feeds the next piece of the answer text: returns the events the moment they pass, and the new prose. Throws AnswerFormatError. */
		push(text: string): { events?: string[]; prose: string } {
			const out: { events?: string[]; prose: string } = { prose: "" };
			let prose = carry;
			carry = "";
			for (let i = 0; i < text.length && state !== "done"; i++) {
				const c = text[i]!;
				if (state !== "prose" && (opened += 1) > OPENING_LIMIT) throw fail(`opening ran past ${OPENING_LIMIT} characters without its events closing`);
				const blank = c === " " || c === "\n" || c === "\r" || c === "\t";
				switch (state) {
					case "open":
						if (blank) break;
						if (c === "{") { state = "key"; token = ""; break; }
						if (c === "`") { state = "fence"; break; }
						throw fail("does not open with a JSON object");
					case "fence": // ```json, to the end of its line
						if (c === "\n") state = "open";
						else if (!/[`a-zA-Z \t\r]/.test(c)) throw fail("opens with something other than a JSON object");
						break;
					case "key": // a key, quotes included: "events" or "chapter"
						if (!token && blank) break;
						if (!token && c !== "\"") throw fail(`does not open its next field with "${want}"`);
						token += c;
						if (token.length > 1 && c === "\"") {
							if (token.slice(1, -1) !== want) throw fail(`has ${token} where "${want}" must come`);
							state = "colon";
						} else if (!want.startsWith(token.slice(1))) throw fail(`has another field where "${want}" must come`);
						break;
					case "colon":
						if (blank) break;
						if (c !== ":") throw fail(`has no value for "${want}"`);
						state = want === "events" ? "events" : "body";
						token = "";
						break;
					case "events": // the raw array, captured whole and checked when it closes
						if (!token && blank) break;
						if (!token && c !== "[") throw fail("has events that are not a list");
						token += c;
						if (inString) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === "\"") inString = false; break; }
						if (c === "\"") inString = true;
						else if (c === "[" || c === "{") depth++;
						else if ((c === "]" || c === "}") && --depth === 0) {
							let value: unknown;
							try { value = JSON.parse(token); } catch { throw fail("has events that are not valid JSON"); }
							const checked = eventsSchema.safeParse(value);
							if (!checked.success) throw fail(`has events that do not fit (${checked.error.issues[0]?.message ?? "invalid"}): exactly 6 non-blank strings`);
							events = checked.data;
							out.events = events;
							state = "comma";
						}
						break;
					case "comma":
						if (blank) break;
						if (c !== ",") throw fail("has no chapter after its events");
						state = "key"; want = "chapter"; token = "";
						break;
					case "body":
						if (blank) break;
						if (c !== "\"") throw fail("has a chapter that is not text");
						state = "prose";
						break;
					case "prose":
						if (hex !== null) {
							if (!/[0-9a-fA-F]/.test(c)) { prose += "�"; hex = null; i--; break; } // a malformed \u escape: replaced, and this character read again
							hex += c;
							if (hex.length === 4) { prose += String.fromCharCode(Number.parseInt(hex, 16)); hex = null; }
						} else if (escaped) { escaped = false; if (c === "u") hex = ""; else prose += ESCAPES[c] ?? c; }
						else if (c === "\\") escaped = true;
						else if (c === "\"") state = "done";
						else prose += c;
						break;
				}
			}
			// A trailing high surrogate waits for its pair; any lone surrogate left is replaced.
			if (state !== "done" && prose && isHigh(prose.charCodeAt(prose.length - 1))) { carry = prose.slice(-1); prose = prose.slice(0, -1); }
			if (prose) { out.prose = prose.toWellFormed(); chapter += out.prose; }
			return out;
		},
	};
}
