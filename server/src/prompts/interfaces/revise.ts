// The revise prompt: the reader's chapter revised as they ask, from one detail to a new course of events
// The text is NovelSpell's remix_revise prompt, word for word. Edit it here: `npm run prompts` shows the exact request it builds.
import { z } from "zod";
import { definePrompt, json } from "../core/define.js";
import { captionCopied, chapterAnswer, forkInfo, readerText } from "./_chapter.js";

export default definePrompt({
	name: "revise",
	description: "the reader's chapter revised as they ask, from one detail to a new course of events",
	model: "writer",
	system: `

You revise a chapter of INFO.title by INFO.author that a reader has read, as
they ask, so that a devoted reader of the book could take your text for the
author's own.

`,
	task: `

INFO.chapter is cut at the fork: INFO.chapter.beforeFork is the book's text up
to it, which the reader has read and you do not rewrite; INFO.chapter.afterFork
is the rest as the author wrote it. DATA.previous is the reader's new course
from the fork, in which DATA.request happens: its six events and its text. You
return DATA.previous revised as DATA.instruction asks.

THE CHANGE
- DATA.instruction may ask for anything from one detail to a different course of
events or ending, or a different tone, pace or point of view. Carry out every
element it names, at the strength asked, in the nearest form the book's world
allows, as a real event of the story unless it asks for a dream or a
might-have-been.
- Change what it reaches and whatever must change with it, and keep the rest as
DATA.previous has it, word for word: a change from some point on keeps the text
up to that point; a change to the whole text keeps its story and writes every
passage anew in the new manner: the author's own manner turned that way, in the
author's sentences and diction, never clipped or modern; a new narrator tells it
as their own account, not the old text with its pronouns changed.
- DATA.request still happens at the fork unless DATA.instruction undoes part of
it, and nothing kept contradicts the change.

FIRST, THE EVENTS: YOUR PLAN
- Before any prose, plan the revised course as six beats in story order, spread
across it: the first is the change at the fork, the last is where the course
lands, and each between is a turn that follows from the one before, a decision,
discovery, arrival, confrontation or reversal the chapter could not do without.
Keep word for word each of DATA.previous.events that the revised text still
reaches as it says; a turn the revision adds or changes is one of the six.
- Write each beat as the caption of its comic panel, which an artist who knows
the characters' looks only by name draws while you write the prose: one
present-tense sentence of the beat's peak instant, saying where it is, who is
there (named as the book names them) and the beat's own action, not a passing
gesture or pose. No speech, sounds or thoughts.

THEN, THE TEXT: THE BEATS WRITTEN OUT
- Continue from the last words of INFO.chapter.beforeFork, as if there were no
cut, and write the course your events lay out, in their order. Dramatize each on
the page, building to the instant its caption shows, in your own words. The
events are the chapter's spine, not an outline to translate.
- Never mention the revision. Write roughly as much as DATA.previous.chapter
unless DATA.instruction asks for more or less, in Markdown: paragraphs,
*italics*, and a line of *** only where time or place jumps. No title, headings
or notes.

`,
	quality: [
		{ name: "instruction fidelity", text: `

DATA.instruction is carried out as fully as the reader meant it: every element
it names, at the strength they asked for, plain on the page wherever it matters,
and a vague instruction given its most evident meaning.

` },
		{ name: "anchored to previous", text: `

The text is DATA.previous with the change made as far as DATA.instruction
reaches: what it does not reach is kept word for word, events included; a change
from some point on keeps everything before it; a change to the whole text keeps
its story and puts every passage in the new manner rather than adding lines to
kept text; and nothing kept contradicts the change.

` },
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
the author uses it; except where DATA.instruction asks for another manner, and
then the new passages cannot be told from the kept ones.

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

The change carries through the text: effects follow from cause, with a cost,
surprising but not arbitrary, changed and kept passages read as one text with no
seam, repetition or loose end, and an ending the change alters lands on an
image, decision or reversal, with no summing-up or moral.

` },
	],
	rules: [
		`

DATA.instruction is carried out in the text, with every element it names (or its
nearest form the book's world allows). It fails only if an element is missing,
if what it asks for is left a dream, a vision or a might-have-been it did not
ask for, or if the text refuses, apologises, comments or mentions the revision.

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
		request: readerText.describe("The reader's original what-if, which DATA.previous answers at the fork, in their own words."),
		previous: chapterAnswer.describe("The reader's chapter from the fork on, as the writer (or an earlier revise) returned it: its six events and its text."),
		instruction: readerText.describe("The change the reader wants made to DATA.previous, in their own words."),
	}),
	output: json({
		schema: chapterAnswer,
		description: `

The six events, the revised chapter's beats as panel captions, then its text
from the fork on written from them, in this order.

`,
		checks: [captionCopied],
	}),
});
