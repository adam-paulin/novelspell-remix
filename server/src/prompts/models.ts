// The models by role. Prompts name a role ("writer", "illustrator"), never a model id, so swapping a model, its effort or its reasoning
// strength is a one-line change here. The Worker (config.ts WRITERS / ILLUSTRATOR_MODEL) and the payload CLI (prompt-cli/) both
// read these: the Worker sends text prompts with the writer role and pictures with the illustrator role. fastWriter is not a prompt
// role: it is the writer role's model in Fast mode (buildRequest's model override). THINKING sets each writer's effort by the
// reader's thinking dial.

/** The model APIs, by provider id, each at its default base URL (every one speaks the same Responses API). Each model names its provider. */
export const PROVIDER_URLS = {
	meta: "https://api.meta.ai/v1",
	baseten: "https://inference.baseten.co/v1",
} as const;
export type ProviderId = keyof typeof PROVIDER_URLS;

/** The Meta Model API every Meta request goes to, unless META_BASE_URL overrides it. */
export const META_API_URL = PROVIDER_URLS.meta;

export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface TextModel {
	kind: "text";
	/** The API that serves it. */
	provider: ProviderId;
	/** The model id the API expects. */
	id: string;
	/** Reasoning effort sent as `reasoning.effort` (the dial's Low level; THINKING has the others); null sends none. */
	effort: Effort | null;
	/** The answer's token cap (`max_output_tokens`): far above a real chapter (about 4-9k tokens), so it never binds. */
	maxOutputTokens: number;
	/** USD per million tokens (reasoning tokens bill as output). */
	price: { input: number; cachedInput: number; output: number };
}

export interface ImageModel {
	kind: "image";
	provider: ProviderId;
	id: string;
	/** Muse Image's `reasoning_strength`. */
	reasoningStrength: "low" | "medium" | "high";
	/** The picture's file format (`output_format`). */
	format: "jpeg" | "png";
	/** The picture's short edge in pixels; the long edge follows the prompt's aspect ratio. */
	shortEdge: number;
	/** USD per delivered picture. */
	price: { perImage: number };
}

export type Model = TextModel | ImageModel;

export const MODELS = {
	/** Muse Wonder 1.0 (preview), streamed through the Responses API: it writes clearly better than Muse Spark 1.3 (blind reads and the
	 *  review panel, 2026-11-04). Efforts minimal..max. */
	writer: { kind: "text", provider: "meta", id: "muse-wonder-1.0", effort: "medium", maxOutputTokens: 32_768, price: { input: 4, cachedInput: 0.2, output: 20 } },
	/** Fast mode: Muse Spark Open, Meta's open-weights model, on Baseten (the hackathon key, active until Nov 9).
	 *  Same prompts and Responses API; it starts writing and streams far sooner (2026-11-04: first text 3 s, done 34 s, vs 41 s and 121 s). */
	fastWriter: { kind: "text", provider: "baseten", id: "meta-models/muse-spark-open-1026", effort: "medium", maxOutputTokens: 32_768, price: { input: 1.25, cachedInput: 0.15, output: 4.25 } },
	// reasoning_strength "high" for every picture: clearly better comics and covers, about +16 s a comic
	// and +1.4 s a cover, still a flat $0.01.
	illustrator: { kind: "image", provider: "meta", id: "muse-image-1.0", reasoningStrength: "high", format: "jpeg", shortEdge: 1024, price: { perImage: 0.01 } },
} as const satisfies Record<string, Model>;

export type ModelKey = keyof typeof MODELS;

/** The reader's thinking dial: Low, Medium, High. */
export const THINKING_LEVELS = ["low", "medium", "high"] as const;
export type Thinking = (typeof THINKING_LEVELS)[number];
/** The level used when a request sends none (the studio always sends one, Medium by default). */
export const DEFAULT_THINKING: Thinking = "medium";

/**
 * Each writer's effort per dial level (measured 2026-11-04 on the chapter job, one review panel). Wonder: medium 73 s / ~$0.14 a
 * chapter, xhigh 109 s / ~$0.20, max 210 s / ~$0.32, each step better (high added little over medium, so it is skipped). Spark Open:
 * medium 20 s, high 27 s, xhigh 61 s (its top level; Baseten refuses max). Fast mode stays faster at every level.
 */
export const THINKING = {
	writer: { low: "medium", medium: "xhigh", high: "max" },
	fastWriter: { low: "medium", medium: "high", high: "xhigh" },
} as const satisfies Record<"writer" | "fastWriter", Record<Thinking, Effort>>;

/**
 * A typical chapter's output tokens (answer + reasoning, which bills as output) at each effort, for the spend cap's reservation and the
 * CLI's estimate. From the 2026-11-04 measurements: the answer is about 4,500 tokens; reasoning adds about 1,200-3,600 at medium,
 * 2,700 at high, 7,000-12,800 at xhigh and 13,000 at max (Wonder max: about $0.32 a chapter).
 */
export const TYPICAL_OUTPUT_TOKENS: Record<Effort | "none", number> = { none: 4500, minimal: 4500, low: 4500, medium: 4500, high: 7500, xhigh: 12_000, max: 18_000 };
