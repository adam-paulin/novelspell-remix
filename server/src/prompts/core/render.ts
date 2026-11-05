// Prompt + input -> the text the model reads, in two parts:
//   prefix: everything every call of one series shares (system, task, INFO, the answer schema). It comes first so the API can cache it,
//           and its hash is the cache key;
//   suffix: what this call brings (the data block, and for a JSON answer the one-line answer instruction).
// A text model receives prefix as `instructions` and suffix as the user message; an image model receives both joined as one prompt
// (request.ts). The order and the split are the same for both kinds.
// Runs in the Worker and in Node alike: Web Crypto only, nothing from node:*.
import { z } from "zod";
import type { Fields, Prompt } from "./define.js";

/** Prose wrapped for people -> the text the model reads: trimmed, and a single line break becomes a space unless the next line starts a "- " item. */
export const flow = (text: string) => text.replace(/\r\n?/g, "\n").trim().replace(/([^\n])\n(?!\n|- )/g, "$1 ");

export const block = (name: string, body: string) => `<${name}>\n${body}\n</${name}>`;

const encoder = new TextEncoder();
export const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("");

/** The answer instruction that closes every JSON prompt, after the data. */
export const ANSWER_LINE = "Answer with only one JSON value that matches SCHEMA: no Markdown fence, no wrapper and no other text.";

export interface Rendered {
	prefix: string;
	suffix: string;
}

/** sha256 of the prefix: equal keys mean an identical cacheable prefix. */
export const cacheKey = (rendered: Rendered) => sha256(rendered.prefix);

/** The answer schema shown to the model: Zod's JSON Schema led by the output's description (one source: a .describe() on the schema is replaced), without `$schema`. */
export function answerSchema(schema: z.ZodType, description: string): string {
	const { $schema: _, description: __, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
	return JSON.stringify({ description: flow(description), ...rest });
}

/** The task with its quality and rules sections, as one text. */
function taskText(prompt: Prompt): string {
	const checks = prompt.output.kind === "json" ? prompt.output.checks.map(check => check.rule) : [];
	const rules = [...(prompt.rules ?? []), ...checks];
	return [
		flow(prompt.task),
		...(prompt.quality?.length ? [block("QUALITY", `What an excellent answer does:\n${prompt.quality.map(item => `- ${item.name}: ${flow(item.text)}`).join("\n")}`)] : []),
		...(rules.length ? [block("RULES", `Hard requirements every answer must meet:\n${rules.map(rule => `- ${flow(rule)}`).join("\n")}`)] : []),
	].join("\n\n");
}

/** One input part through its strict shape (an undeclared key is an error, never passed on to the model), or a readable error naming the prompt, the part and the field. */
function parsePart(prompt: Prompt, part: "info" | "data", shape: Fields, value: unknown): unknown {
	const result = shape.strict().safeParse(value);
	if (!result.success) throw new Error(`The ${prompt.name} prompt refused its ${part}: ${z.prettifyError(result.error).replace(/\n/g, " ")}`);
	return result.data;
}

/**
 * Validates the input against the prompt's Zod shapes and renders it. Unknown keys are refused, so nothing the prompt did not declare
 * reaches the model. Throws an Error naming the part and the field when the input does not fit.
 */
export function render(prompt: Prompt, input: { info?: unknown; data: unknown }): Rendered {
	if (!prompt.info && input.info !== undefined) throw new Error(`The ${prompt.name} prompt takes no info.`);
	const info = prompt.info ? parsePart(prompt, "info", prompt.info, input.info) : undefined;
	const data = parsePart(prompt, "data", prompt.data, input.data);
	const prefix = [
		...(prompt.system ? [flow(prompt.system), block("TASK", taskText(prompt))] : [taskText(prompt)]),
		...(info !== undefined ? [block("INFO", JSON.stringify(info))] : []),
		...(prompt.output.kind === "json" ? [block("SCHEMA", answerSchema(prompt.output.schema, prompt.output.description))] : []),
	].join("\n\n");
	const dataJson = prompt.dataFormat === "pretty" ? JSON.stringify(data, null, 2) : JSON.stringify(data);
	const suffix = [block(prompt.dataTag ?? "DATA", dataJson), ...(prompt.output.kind === "json" ? [ANSWER_LINE] : [])].join("\n\n");
	return { prefix, suffix };
}
