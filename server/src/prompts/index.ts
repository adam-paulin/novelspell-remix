// The prompts: every word the models read comes from here. One file per prompt in interfaces/, one core (core/) that renders any of
// them, text or image, into the exact Meta request. The Worker and the payload CLI (prompt-cli/) import only from this file.
//
// The rule the Worker relies on: rendering is deterministic. The early comic (started while the writer is still writing) is reused for
// the final chapter only when both prompts are byte-identical (earlyImages.ts claim()).
import type { Fields, ImageOutput, Prompt } from "./core/define.js";
import { render } from "./core/render.js";
import { imageText, modelOf, sizeOf } from "./core/request.js";
import comic from "./interfaces/comic.js";
import cover from "./interfaces/cover.js";
import revise from "./interfaces/revise.js";
import writer from "./interfaces/writer.js";

/** Every prompt by name. A new prompt: its file in interfaces/ and one line here. */
export const PROMPTS = { writer, revise, cover, comic } as const;

// Checked once, at load (the Worker's startup, the CLI's start): a mistake fails at once instead of on the first request.
for (const [name, prompt] of Object.entries(PROMPTS) as [string, Prompt][]) {
	if (prompt.name !== name) throw new Error(`prompts: "${name}" is registered under another name ("${prompt.name}").`);
	const model = modelOf(prompt); // the role exists and its kind fits the output
	if (prompt.output.kind === "image" && model.kind === "image") sizeOf(prompt.output.aspectRatio, model.shortEdge);
}

/** An image prompt and its input -> the picture job's text and aspect ratio. Throws an Error naming the field when the input does not fit. */
export function imagePrompt(prompt: Prompt<Fields | undefined, Fields, ImageOutput>, input: { info?: unknown; data: unknown }): { prompt: string; aspect_ratio: string } {
	return { prompt: imageText(render(prompt, input)), aspect_ratio: prompt.output.aspectRatio };
}

export type { Prompt } from "./core/define.js";
export { cacheKey, render } from "./core/render.js";
export { buildRequest, checkAnswer, imageBody, modelOf } from "./core/request.js";
export { DEFAULT_THINKING, META_API_URL, MODELS, PROVIDER_URLS, THINKING, THINKING_LEVELS, TYPICAL_OUTPUT_TOKENS, type Effort, type ProviderId, type TextModel, type ImageModel, type Model, type Thinking } from "./models.js";
