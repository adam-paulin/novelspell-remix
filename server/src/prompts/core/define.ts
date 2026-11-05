// The prompt interface: what one file in interfaces/ declares. A prompt is words, the shapes of its inputs, and the shape of what it
// produces. It holds no logic: the core (render.ts, request.ts) turns every prompt into a request the same way, for the Worker and
// for the payload CLI (prompt-cli/) alike. A new prompt is a file in interfaces/ plus one line in index.ts.
//
// One interface for both kinds of prompt. The output decides the kind:
//   json(...)  -> a text model answers with one JSON value (the writer and the reviser);
//   image(...) -> an image model draws one picture (the cover and the comic page).
//
// Writing a prompt:
//   - Prose is written wrapped for people, as template literals with a blank line above and below the text. The core trims it and
//     joins wrapped lines back into one (a single line break becomes a space unless the next line starts a "- " list item; blank
//     lines stay), so wrapping never reaches the model.
//   - `system` (optional) is the opening text. `task` follows it: in a <TASK> block when there is a system text, as plain text when
//     there is none. `quality` and `rules` join the task.
//   - `info` is what every call of one series shares (one book's map): it goes in the cached prefix. `data` is what each call
//     brings (the reader's request): it goes last. Both are Zod objects; their declared key order is the order the model reads, and a
//     key they do not declare is refused. Only the values reach the model: .describe() text on these fields is for people.
//   - The model (id, effort, reasoning strength) is chosen by role in models.ts, never per prompt: a prompt that needs other settings
//     gets its own role there.
// The registry (index.ts) checks every prompt when it loads: its name, its model role against its output kind, its aspect ratio.
import { z } from "zod";
import type { ModelKey } from "../models.js";

/**
 * A rule about an answer that code can test. Its text joins the prompt's rules, so the model is told it. The payload CLI rejects a sent
 * answer that fails it; the Worker enforces only the opening of the writer's answer as it streams (answerStream.ts), not these checks.
 */
export interface Check<Answer> {
	rule: string;
	test: (answer: Answer) => boolean;
}

export interface JsonOutput<Schema extends z.ZodType = z.ZodType> {
	kind: "json";
	/**
	 * The answer's shape. It is shown to the model as JSON Schema (in the cached prefix) and every answer is validated against it.
	 * Unlike on info and data, a .describe() on a field here IS shown to the model.
	 */
	schema: Schema;
	/** What the answer is, in words (shown to the model as the schema's description). */
	description: string;
	checks: Check<z.output<Schema>>[];
}

export interface ImageOutput {
	kind: "image";
	/** "W:H" in whole numbers, between 1:16 and 16:1. */
	aspectRatio: string;
}

export type Output = JsonOutput | ImageOutput;

/** A Zod object whose parsed output is serialized as the model reads it. */
export type Fields = z.ZodObject<z.ZodRawShape>;

export interface Prompt<Info extends Fields | undefined = Fields | undefined, Data extends Fields = Fields, Out extends Output = Output> {
	/** The prompt's name: its key in the registry (index.ts PROMPTS), which entries refer to; by convention also its file name. */
	name: string;
	/** One line for people: what the prompt makes. */
	description: string;
	/**
	 * The model role that answers it (models.ts): a text role for json(), an image role for image(). The Worker sends text prompts with
	 * the writer role and pictures with the illustrator role; a new role also needs its Worker wiring (metaClient.ts, config.ts).
	 */
	model: ModelKey;
	system?: string;
	task: string;
	/** What an excellent answer does, one line each ("name": what perfect looks like). */
	quality?: { name: string; text: string }[];
	/** Hard requirements, one each. */
	rules?: string[];
	/** Shared by every call of a series: rendered in the cached prefix as <INFO>. */
	info?: Info;
	/** Each call's own input: rendered last. */
	data: Data;
	/** The block name the data is rendered in. Default "DATA". */
	dataTag?: string;
	/** How the data JSON is written: "compact" (default, fewest tokens) or "pretty" (two-space indents, for prompts written that way). */
	dataFormat?: "compact" | "pretty";
	output: Out;
}

export const json = <Schema extends z.ZodType>(output: { schema: Schema; description: string; checks?: Check<z.output<Schema>>[] }): JsonOutput<Schema> =>
	({ kind: "json", schema: output.schema, description: output.description, checks: output.checks ?? [] });

export const image = (output: { aspectRatio: string }): ImageOutput => ({ kind: "image", aspectRatio: output.aspectRatio });

/** Declares a prompt. Identity at runtime: the type checks the declaration; the registry (index.ts) checks the rest when it loads. */
export const definePrompt = <Info extends Fields | undefined, Data extends Fields, Out extends Output>(prompt: Prompt<Info, Data, Out>) => prompt;
