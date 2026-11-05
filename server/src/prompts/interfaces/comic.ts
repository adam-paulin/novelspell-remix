// The comic prompt: one comic page of six wordless panels, one per key moment of the chapter, in order.
// Source text: written for this app.
import { z } from "zod";
import { definePrompt, image } from "../core/define.js";

export default definePrompt({
	name: "comic",
	description: "one comic page of six wordless panels, one per key moment of the chapter",
	model: "illustrator",
	task: `

You must make a stunning comic panel image to depict 6 events from a canon-divergence fan-fiction
novel.

COMIC_INFO.original is the reference book to anchor all your character depictions, world and style
to by default, unless overridden by COMIC_INFO.change, which should be a priority to portray
thematically throughout the panel art.

REQUIREMENTS:
- All unique characters depicted must appear sufficiently distinct from each other to be easily told
apart and it is critical that no characters can be mistaken for one another.
- Lay the 6 panels out as a grid 2 panels wide and 3 panels tall of equal square panels.
- You must produce exactly 1 panel per event in the order from the first to the last event in the
array (6 panels total), as read from left to right and top to bottom by a western reader.
- Include absolutely no text of any kind, the visuals alone must speak for themselves: no dialogue,
thought bubbles, captions, numbers or overlay graphics, and no lettering inside the artwork either
(signs, banners, clothing, books, letters and papers stay unmarked).

`,
	data: z.strictObject({
		original: z.strictObject({ title: z.string().min(1), author: z.string().min(1) }).describe("The classic the chapter leaves."),
		change: z.string().min(1).describe("The reader's what-if."),
		events: z.array(z.string().regex(/\S/)).length(6).describe("The chapter's six key moments, in order: one panel each."),
		cast: z.array(z.strictObject({ name: z.string().min(1), role: z.string().optional() })).describe("The people the events name, as the caller picked them from the book map."),
	}),
	dataTag: "COMIC_INFO",
	dataFormat: "pretty",
	output: image({ aspectRatio: "2:3" }),
});
