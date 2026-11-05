// Rendered prompt -> the exact Meta Model API request body. The one builder: the Worker's Meta client (metaClient.ts) and the payload
// CLI (prompt-cli/) both call it, so a payload the CLI writes is the body the Worker sends.
//   text model:  POST {baseUrl}/responses             streamed; prefix as `instructions`, suffix as the one user message
//   image model: POST {baseUrl}/images/generations    prefix and suffix joined as `prompt`
// Field order is fixed, so the same prompt and input always give byte-identical bodies.
import { MODELS, type ImageModel, type Model, type TextModel } from "../models.js";
import type { Prompt } from "./define.js";
import { cacheKey, sha256, type Rendered } from "./render.js";

export function modelOf(prompt: Prompt): Model {
	const model = (MODELS as Record<string, Model>)[prompt.model];
	if (!model) throw new Error(`${prompt.name}: no model role "${prompt.model}" in models.ts.`);
	const wants = prompt.output.kind === "json" ? "text" : "image";
	if (model.kind !== wants) throw new Error(`${prompt.name}: its ${prompt.output.kind} output needs a ${wants} model, but "${prompt.model}" is an ${model.kind} model.`);
	return model;
}

/** Muse Image takes the aspect ratio as WxH with the model's short edge. Throws a RangeError for anything but "W:H" between 1:16 and 16:1. */
export function sizeOf(aspectRatio: string, shortEdge: number): string {
	const match = /^(\d+):(\d+)$/.exec(aspectRatio);
	if (!match) throw new RangeError(`Aspect ratio "${aspectRatio}" is not W:H in whole numbers.`);
	const ratio = Number(match[1]) / Number(match[2]);
	if (!(ratio >= 1 / 16 && ratio <= 16)) throw new RangeError(`Aspect ratio ${aspectRatio} is outside 1:16 to 16:1.`);
	return ratio >= 1 ? `${Math.round(shortEdge * ratio)}x${shortEdge}` : `${shortEdge}x${Math.round(shortEdge / ratio)}`;
}

/** The Responses API body of one text call. */
export async function textBody(model: Pick<TextModel, "id" | "effort" | "maxOutputTokens">, rendered: Rendered) {
	return {
		model: model.id,
		max_output_tokens: model.maxOutputTokens,
		store: false,
		...(model.effort ? { reasoning: { effort: model.effort } } : {}),
		// One key per model and prefix: calls that share a prefix are routed to the same cache.
		prompt_cache_key: (await sha256(`${model.id}\n${await cacheKey(rendered)}`)).slice(0, 32),
		stream: true,
		instructions: rendered.prefix,
		input: [{ role: "user", content: rendered.suffix }],
	};
}

/** The text an image model reads: one prompt, prefix then suffix. */
export const imageText = (rendered: Rendered) => `${rendered.prefix}\n\n${rendered.suffix}`;

/** The /images/generations body of one picture. */
export function imageBody(model: Pick<ImageModel, "id" | "reasoningStrength" | "format" | "shortEdge">, prompt: string, aspectRatio: string) {
	return {
		model: model.id,
		prompt,
		n: 1,
		size: sizeOf(aspectRatio, model.shortEdge),
		output_format: model.format,
		reasoning_strength: model.reasoningStrength,
		tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
	};
}

/**
 * Any prompt -> its API path and body, with its role's model from models.ts, or `override` (a model of the same kind, e.g.
 * MODELS.fastWriter for the writer role in Fast mode). The Worker and the CLI both build their bodies here.
 */
export async function buildRequest(prompt: Prompt, rendered: Rendered, override?: Model): Promise<{ path: "/responses" | "/images/generations"; body: Record<string, unknown> }> {
	const role = modelOf(prompt);
	if (override && override.kind !== role.kind) throw new Error(`${prompt.name}: the override is an ${override.kind} model, but its role "${prompt.model}" needs a ${role.kind} model.`);
	const model = override ?? role;
	if (model.kind === "text") return { path: "/responses", body: await textBody(model, rendered) };
	if (prompt.output.kind !== "image") throw new Error(`${prompt.name}: an image model needs an image() output.`);
	return { path: "/images/generations", body: imageBody(model, imageText(rendered), prompt.output.aspectRatio) };
}

/** A JSON answer against the prompt's schema and checks (the CLI's check of a sent answer). */
export function checkAnswer(prompt: Prompt, text: string): { ok: boolean; answer?: unknown; problems: string[] } {
	if (prompt.output.kind !== "json") return { ok: false, problems: ["Not a JSON prompt."] };
	let value: unknown;
	try { value = JSON.parse(text); } catch { return { ok: false, problems: ["The answer is not JSON."] }; }
	const parsed = prompt.output.schema.safeParse(value);
	if (!parsed.success) return { ok: false, answer: value, problems: parsed.error.issues.map(issue => `${issue.path.join(".") || "(answer)"}: ${issue.message}`) };
	const failed = prompt.output.checks.filter(check => !check.test(parsed.data)).map(check => check.rule);
	return { ok: !failed.length, answer: parsed.data, problems: failed };
}
