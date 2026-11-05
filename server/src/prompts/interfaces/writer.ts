// The writer prompt: the rest of a classic's chapter from the fork where the reader's what-if changes it
// The text is NovelSpell's remix_chapter prompt, word for word. Edit it here: `npm run prompts` shows the exact request it builds.
import { z } from "zod";
import { definePrompt, json } from "../core/define.js";
import { captionCopied, chapterAnswer, forkInfo, readerText } from "./_chapter.js";

export default definePrompt({
	name: "writer",
	description: "the rest of a classic's chapter from the fork where the reader's what-if changes it",
	model: "writer",
	system: `

You continue a chapter of INFO.title by INFO.author from the moment DATA.request
changes it, so that a devoted reader of the book could take your text for the
author's own.

`,
	task: `

INFO.chapter is cut at the fork: INFO.chapter.beforeFork is the book's text up
to it, which the reader has read and you do not rewrite; INFO.chapter.afterFork
is the rest as the author wrote it. You replace INFO.chapter.afterFork with a
new course, in which DATA.request happens at the fork and everything after
follows from it.

FIRST, THE EVENTS: YOUR PLAN
- Before any prose, plan the new course as six beats in story order, spread
across it: the first is the change itself, the last is where the new course
lands, and each between is a turn that follows from the one before, a decision,
discovery, arrival, confrontation or reversal the chapter could not do without.
- Write each beat as the caption of its comic panel, which an artist who knows
the characters' looks only by name draws while you write the prose: one
present-tense sentence of the beat's peak instant, saying where it is, who is
there (named as the book names them) and the beat's own action, not a passing
gesture or pose. No speech, sounds or thoughts.

THEN, THE TEXT: THE BEATS WRITTEN OUT
- Continue from the last words of INFO.chapter.beforeFork, as if there were no
cut, and write the course your events lay out, in their order. Dramatize each on
the page, building to the instant its caption shows, in your own words;
everything between them, the approach, the talk, the setting and the aftermath,
is yours to write. The events are the chapter's spine, not an outline to
translate.
- Keep from INFO.chapter.afterFork only what is still true after the change: no
line that answers, recalls or depends on what the change removed.
- Write roughly as much as INFO.chapter.afterFork, in Markdown: paragraphs,
*italics*, and a line of *** only where time or place jumps. No title, headings
or notes.

`,
	quality: [
		{ name: "faithful to book", text: `

Nothing contradicts INFO.chapter.beforeFork or the book before this chapter, no
one knows what they cannot yet know, nothing kept from INFO.chapter.afterFork
depends on what the change removed, and people, places, customs and objects
match the book except where the change alters them.

` },
		{ name: "voice fidelity", text: `

The text reads on from INFO.chapter.beforeFork without a seam and writes as the
author does in both parts of INFO.chapter: the same narrator, person, tense,
point of view and handling of speech; the same rhythm, sentence and paragraph
length, diction, narrator's stance and interventions, humour or gravity and
habits of description; no modern idiom or spareness, and no habit used more than
the author uses it.

` },
		{ name: "scene presence", text: `

The reader is inside the scene: places, bodies, objects, sounds and weather are
particular and period-true, turning moments are dramatized, what people do and
say carries the meaning, summary, commentary and explanation of feelings or
motives appear only as the author uses them, and nothing is generic or merely
moves people about.

` },
		{ name: "character truth", text: `

Each character wants something, speaks as only they would, with subtext and
conflict, and decides as they would in the book.

` },
		{ name: "picture directions", text: `

The events are the text's high points in story order, one of them the moment of
the change, each a drawable instant whose people, action, pose, place and
objects agree with what the text shows at that moment. Leaving out a person or
object present is no fault: it is simply not drawn.

` },
		{ name: "consequence", text: `

The change transforms the rest of the chapter: effects follow from cause, with a
cost, surprising but not arbitrary, taking the story where the book never went.

` },
		{ name: "shape and ending", text: `

The text has a clear arc that builds to a turn and ends once it lands, on an
image, decision or reversal that leaves the reader wanting the next chapter,
with no summing-up or moral.

` },
	],
	rules: [
		`

DATA.request happens in the text as a real event of the story, with every
element it names (or its nearest form the book's world allows). It fails only if
an element is missing, if the change is left a dream, a vision or a
might-have-been the request did not ask for, or if the text refuses, apologises
or comments.

`,
		`

The content stays at the book's level. It fails only on sexually explicit
content, any sexualising of someone who is a child in the book, or violence more
graphic than the book's.

`,
		`

Each event's moment happens on the page, in the listed order. It fails only if a
moment is missing, only mentioned or summarised, or out of order; how exactly
its people, action, pose, place and objects match the text counts in
picture_directions.

`,
	],
	info: forkInfo,
	data: z.strictObject({
		request: readerText.describe("The reader's what-if: what happens at the fork instead, in their own words."),
	}),
	output: json({
		schema: chapterAnswer,
		description: `

The six events, the chapter's beats as panel captions, then the chapter's new
text written from them, in this order.

`,
		checks: [captionCopied],
	}),
});
