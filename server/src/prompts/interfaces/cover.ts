// The cover prompt: the front cover of the alternate book a reader's change implies, drawn when a chapter is created.
// Source text: written for this app.
import { z } from "zod";
import { definePrompt, image } from "../core/define.js";

const line = z.string().trim().min(1);

export default definePrompt({
	name: "cover",
	description: "the front cover of the alternate book a reader's change implies",
	model: "illustrator",
	task: `

You must create a stunning modern book cover for a fan-fiction divergent canon version of
BOOK_INFO.original. Your cover should represent the alternate universe resulting from
BOOK_INFO.change to the original book.

You should choose a title for your cover that elegantly encapsulates the alternate book universe
resulting from BOOK_INFO.change. Your chosen title must be completely distinct from
BOOK_INFO.original.title.

The author appearing on your cover must be exactly the fan-fiction author BOOK_INFO.author.

Assume the target audience is the same as the original book's.

Only hints of the original book should remain, and your cover concept should lean heavily into the
new universe implied by BOOK_INFO.change and present it saliently.

REQUIREMENTS
- The only readable text must be your chosen title and BOOK_INFO.author. Both must be prominent and
readable, with high contrast against the artwork.
- Your chosen title should appear near the top of the book with very comfortable padding above it
and on either side.
- BOOK_INFO.author should appear near the bottom of the book with very comfortable padding below it
and on either side.

`,
	data: z.strictObject({
		original: z.strictObject({ title: line, author: line }).describe("The classic the change is made to."),
		change: line.describe("The reader's what-if."),
		author: line.describe("The author line printed on the cover."),
	}),
	dataTag: "BOOK_INFO",
	dataFormat: "pretty",
	output: image({ aspectRatio: "2:3" }),
});
