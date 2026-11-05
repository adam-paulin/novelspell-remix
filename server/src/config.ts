// The Worker's bindings, secrets and vars, and the runtime settings read from them. Every var is a string (wrangler.jsonc "vars",
// .dev.vars locally); unset vars fall back to the defaults below.
import { budgetOf, type Budget } from "./spendCap";
import { RoleError } from "./errors";
import { MODELS, PROVIDER_URLS, THINKING, THINKING_LEVELS, type Effort, type ImageModel, type ProviderId, type TextModel, type Thinking } from "./prompts";
import type { PresetTally } from "./presetRuns";

export interface Env {
	/** D1: the spend total, the preset runs and the shared remixes (migrations/). Optional: without it there is no spend cap ledger, no preset record and no sharing. */
	DB?: D1Database;
	/** The version id for /api/health (`wrangler dev` supplies a local one; null without the binding). */
	CF_VERSION_METADATA?: WorkerVersionMetadata;
	/** Secret: the Meta Model API key. Without it no call is sent (meta_unconfigured). */
	META_MODEL_API_KEY?: string;
	/** Secret: the Baseten key (Fast mode's writer). Without it a Fast-mode call is not sent (baseten_unconfigured); normal mode is unaffected. */
	BASETEN_API_KEY?: string;
	/** Secret, 32+ characters: signs version tokens and picture signatures. */
	VERSION_SECRET?: string;
	/** The Meta Model API base URL (default https://api.meta.ai/v1). Point it at a local fake (http://127.0.0.1:PORT/v1) for free local runs. */
	META_BASE_URL?: string;
	/** The Baseten base URL (default https://inference.baseten.co/v1). */
	BASETEN_BASE_URL?: string;
	/** "1" = the free local mode (npm run dev:mock passes it; never put it in wrangler.jsonc): every provider is answered by the loopback fake at META_BASE_URL, and /api/health says mock: true. */
	MOCK?: string;
	/** Comma-separated browser origins allowed to call this API (CORS) and to start work (the static site's origin). */
	SITE_ORIGINS?: string;
	/** The Meta Model API's spend budget in USD at list price (writer and pictures); unset or "" = no cap. */
	META_SPEND_CAP_USD?: string;
	/** Baseten's spend budget in USD at list price (Fast mode's writer); unset or "" = no cap. */
	BASETEN_SPEND_CAP_USD?: string;
	/** What all shared pictures together may hold, in MB (default 400). */
	SHARE_STORE_CAP_MB?: string;
	WRITER_TIMEOUT_MS?: string;
	WRITER_FIRST_DELTA_MS?: string;
	WRITER_STALL_MS?: string;
	ILLUSTRATOR_TIMEOUT_MS?: string;
	/** How many more times a failed model call is tried (metaClient.ts has the one rule), default 3. */
	RETRIES?: string;
	/** How many more times a failed picture is tried, default 8: Muse Image refuses ordinary comics now and then (content_policy_violation, unbilled, a few seconds each) and the same prompt often passes on a later try. */
	IMAGE_RETRIES?: string;
	RETRY_BASE_MS?: string;
	RETRY_MAX_MS?: string;
	STAGE_BUDGET_MS?: string;
	/** Cloudflare rate-limit binding (wrangler.jsonc "ratelimits"): actions per client per minute (clientLimits.ts). Unbound = no per-minute limit. */
	ACTION_LIMITER?: RateLimit;
	/** Model actions (create, revise, redraw) per client per UTC day; unset or "" = no daily limit (clientLimits.ts). */
	ACTION_DAILY_LIMIT?: string;
}

/**
 * The model APIs this Worker calls. Each has its own key, base URL and spend cap (its own row in the spend ledger), and its own
 * name for messages. Adding a provider is one entry here plus its URL in prompts/models.ts.
 */
export const PROVIDERS = {
	meta: { name: "Meta", keyVar: "META_MODEL_API_KEY", urlVar: "META_BASE_URL", capVar: "META_SPEND_CAP_USD" },
	baseten: { name: "Baseten", keyVar: "BASETEN_API_KEY", urlVar: "BASETEN_BASE_URL", capVar: "BASETEN_SPEND_CAP_USD" },
} as const satisfies Record<ProviderId, { name: string; keyVar: keyof Env; urlVar: keyof Env; capVar: keyof Env }>;

export const DEFAULT_META_BASE_URL = PROVIDER_URLS.meta;

/** One provider as an action calls it: where, with which key, under which budget. */
export interface Endpoint {
	provider: ProviderId;
	name: string;
	keyVar: string;
	baseUrl: string;
	key: string | null;
	budget: Budget | null;
}

/** USD per 1M tokens (reasoning tokens bill as output). */
export interface Price {
	input: number;
	cachedInput: number;
	output: number;
}

const writerEntry = (model: TextModel, effort: Effort) => { const spec = { ...model, effort }; return { provider: spec.provider, model: spec.id, effort, price: spec.price satisfies Price, spec }; };
const byThinking = (model: TextModel, efforts: Record<Thinking, Effort>) => Object.fromEntries(THINKING_LEVELS.map(level => [level, writerEntry(model, efforts[level])])) as Record<Thinking, ReturnType<typeof writerEntry>>;
const illustratorEntry = (spec: ImageModel) => ({ provider: spec.provider, model: spec.id, perImage: spec.price.perImage });

/**
 * The writer by mode and thinking level (the models and efforts are set in prompts/models.ts): normal = Muse Wonder 1.0 on Meta; fast =
 * the reader's Fast mode, Muse Spark Open on Baseten. The thinking dial sets the effort. Mode and level change only the model, its
 * provider and its effort; prompts, pipeline and checks are the same.
 */
export const WRITERS = { normal: byThinking(MODELS.writer, THINKING.writer), fast: byThinking(MODELS.fastWriter, THINKING.fastWriter) } as const;
export type WriterMode = keyof typeof WRITERS;
/** The illustrator: Muse Image on Meta, a flat price per delivered picture, in every mode. */
export const ILLUSTRATOR_MODEL = illustratorEntry(MODELS.illustrator);
/** What /api/health reports: each role's provider and model. One provider per call: a failure shows as a failure, never hidden by a fallback. */
export const MODEL_PROFILE = {
	writer: Object.fromEntries(Object.entries(WRITERS).map(([mode, levels]) => [mode, { provider: levels.low.provider, model: levels.low.model, efforts: Object.fromEntries(THINKING_LEVELS.map(level => [level, levels[level].effort])) }])),
	illustrator: { provider: ILLUSTRATOR_MODEL.provider, model: ILLUSTRATOR_MODEL.model },
};

export interface RetrySettings {
	retries: number;
	baseMs: number;
	maxMs: number;
	maxRetryAfterMs: number;
}

export interface RoleConfig {
	/** Every provider's endpoint, by id. */
	endpoints: Record<ProviderId, Endpoint>;
	tally: PresetTally | null;
	/** The Worker's waitUntil: every model call registers itself until it is booked. null = none. */
	keepAlive: KeepAlive | null;
	retry: RetrySettings;
	stageBudgetMs: number;
	writer: { timeoutMs: number; firstDeltaMs: number | undefined; stallMs: number | undefined };
	/** retries: the illustrator's own retry count (IMAGE_RETRIES). */
	illustrator: { timeoutMs: number; retries: number };
}

// A var as a number: unset or "" = the fallback (note: "0" is a real 0).
function number(value: string | undefined, fallback: number): number;
function number(value: string | undefined, fallback: undefined): number | undefined;
function number(value: string | undefined, fallback: number | undefined): number | undefined {
	return Number.isFinite(Number(value)) && value !== undefined && value !== "" ? Number(value) : fallback;
}

export type KeepAlive = (promise: Promise<unknown>) => void;

// The free local mode never reaches a model: with MOCK "1" a META_BASE_URL that is not loopback fails the action before any call is sent.
const isLoopback = (url: string) => { try { return /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(new URL(url).hostname); } catch { return false; } };

/** Every provider's endpoint from the env. In the free local mode every provider is the loopback fake at META_BASE_URL. */
export function endpointsOf(env: Env): Record<ProviderId, Endpoint> {
	const vars = env as unknown as Record<string, string | undefined>;
	const mock = env.MOCK === "1";
	const entries = (Object.keys(PROVIDERS) as ProviderId[]).map(provider => {
		const spec = PROVIDERS[provider];
		const baseUrl = mock ? env.META_BASE_URL || DEFAULT_META_BASE_URL : vars[spec.urlVar] || PROVIDER_URLS[provider];
		const key = (mock ? vars[spec.keyVar] ?? env.META_MODEL_API_KEY : vars[spec.keyVar]) ?? null;
		return [provider, { provider, name: spec.name, keyVar: spec.keyVar, baseUrl, key, budget: budgetOf(env, provider) }] as const;
	});
	return Object.fromEntries(entries) as Record<ProviderId, Endpoint>;
}

export function roleConfig(env: Env, tally: PresetTally | null = null, keepAlive: KeepAlive | null = null): RoleConfig {
	if (env.MOCK === "1" && !isLoopback(env.META_BASE_URL || DEFAULT_META_BASE_URL)) throw Object.assign(new RoleError("mock_not_local", `MOCK=1 calls only a loopback fake Meta, but META_BASE_URL is ${env.META_BASE_URL || DEFAULT_META_BASE_URL}: nothing was sent.`), { costUsd: 0, billed: false });
	return {
		endpoints: endpointsOf(env),
		// A preset run's call counter (presetRuns.ts): opened when a model call is sent, closed with its cost when it is booked.
		tally,
		keepAlive,
		retry: { retries: number(env.RETRIES, 3), baseMs: number(env.RETRY_BASE_MS, 1000), maxMs: number(env.RETRY_MAX_MS, 30_000), maxRetryAfterMs: 60_000 },
		stageBudgetMs: number(env.STAGE_BUDGET_MS, 14 * 60_000),
		// firstDeltaMs / stallMs: the writer's watchdog (metaClient.ts uses its own defaults when these are unset).
		writer: { timeoutMs: number(env.WRITER_TIMEOUT_MS, 10 * 60_000), firstDeltaMs: number(env.WRITER_FIRST_DELTA_MS, undefined), stallMs: number(env.WRITER_STALL_MS, undefined) },
		illustrator: { timeoutMs: number(env.ILLUSTRATOR_TIMEOUT_MS, 10 * 60_000), retries: number(env.IMAGE_RETRIES, 8) },
	};
}
