// Shared by the writer and the reviser (not a prompt: files starting with "_" hold shared parts and are not in the registry): the fork
// design's INFO, the reader's text, the answer shape and its one check.
import { z } from "zod";
import type { Check } from "../core/define.js";

/** The reader's own words (a request or an instruction). Counts UTF-16 units like the API's request gates (3-2,000 request, 3-1,000 instruction; Zod's min/max would count code points). Its 3,000 cap is a looser backstop, so nothing the gates accept is refused. */
export const readerText = z.string().refine(text => text.length >= 3 && text.length <= 3000, "Must be 3 to 3,000 characters.");

/**
 * INFO of the fork design (writer and revise, 2026-11-04; core remix_chapter / remix_revise): the book's title and author and the chapter
 * cut at the fork (books.ts forkChapter). Every call from one fork shares it, so the writer and revise share one cached prefix shape.
 */
export const forkInfo = z.strictObject({
	title: z.string().min(1),
	author: z.string().min(1),
	chapter: z.strictObject({
		title: z.string(),
		beforeFork: z.string().min(1).describe("The book's own text of the chapter up to the fork, unchanged. The reader has read it; the new text continues from its last words."),
		afterFork: z.string().min(1).describe("The rest of the book's chapter after the fork, unchanged: the course the new text replaces."),
	}),
});

/** Words for caption-run matching, case kept: letters, digits and apostrophes only (curly apostrophes folded). Ported from core/book/remix/chapter.js. */
const runWords = (text: string) => text.replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
const SMALL = new Set("a an the and or but of in on at to from with by for into onto upon over under above below beside before behind after while as who whom that his her hers their its him them he she they it is are was were".split(" "));

/** True when an event's caption shares a run of 8 consecutive words with the chapter that carries at least 3 of the caption's own ordinary words (core captionCopied, unchanged). */
export function captionCopiedIn({ events, chapter }: { events: string[]; chapter: string }, size = 8): boolean {
	const prose = ` ${runWords(chapter).join(" ").toLowerCase()} `;
	return events.some(event => {
		const words = runWords(event);
		for (let i = 0; i + size <= words.length; i++) {
			const run = words.slice(i, i + size);
			if (run.filter(word => word === word.toLowerCase() && !SMALL.has(word)).length < 3) continue;
			if (prose.includes(` ${run.join(" ").toLowerCase()} `)) return true;
		}
		return false;
	});
}

/** The fork design's one answer check (core remixOutput): told to the model as a rule; like every check, enforced only by the CLI. */
export const captionCopied: Check<z.output<typeof chapterAnswer>> = {
	rule: `

Tell each event in the text's own prose: no run of eight or more words from a
caption appears in the text.

`,
	test: answer => !captionCopiedIn(answer),
};

/** The answer: the six key moments first (the comic page starts from them), then the chapter. */
export const chapterAnswer = z.strictObject({
	events: z.array(z.string().regex(/\S/)).length(6),
	chapter: z.string().regex(/\S/),
});
