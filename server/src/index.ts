// NovelSpell Remix API: a stateless, API-only Cloudflare Worker. Every action is one POST whose response streams the whole result as
// binary frames (frames.ts) and then closes. Server-side records live in D1 (binding DB): the spend total (spendCap.ts) and the preset
// runs (presetRuns.ts), both write-only, and the shared remixes (shares.ts), the one record the page reads back.
//   POST /api/remix          { book, request, divergenceId?, fast?, thinking? }  create (fast: true = Fast mode: Muse Spark Open on Baseten
//                            writes; thinking: low | medium | high, default medium = the writer's effort, config.ts WRITERS)
//   POST /api/remix/revise   { instruction, token, fast?, thinking? }  revise the version the token names
//   POST /api/remix/redraw   { token, cover? }                 draw that version's comic again (and a missing cover)
//   POST /api/share          multipart { token, cover?, comic?, coverSig?, comicSig? } -> { id }
//   GET  /api/share/:id      the snapshot (JSON);  GET /api/share-picture/:hash  a picture of it
//   GET  /api/health         { ok, service, version, models, mock, books, budgets: { <provider>: { capUsd, spentUsd } } (capped providers only) }
// Before a stream starts, a refusal is plain JSON { error: { code, message } }.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { allowedOrigin, trustedOrigin } from "./access";
import { limitRefusal } from "./clientLimits";
import { isLibraryBook, libraryBooks } from "./books";
import { budgetOf, spentUsd, type Budget } from "./spendCap";
import { readVersion, versionSecretReady } from "./versionToken";
import { watchPreset } from "./presetRuns";
import { createShare, readShare, readSharePicture } from "./shares";
import { runRemix, type Action } from "./remix";
import { frame, STREAM_HEADERS, type StreamEvent } from "./frames";
import { MODEL_PROFILE, PROVIDERS, type Env } from "./config";
import { DEFAULT_THINKING, THINKING_LEVELS, type ProviderId, type Thinking } from "./prompts";

const BODY_LIMIT = 336 * 1024; // a revise carries its version token: room for the longest one this service signs (versionToken.ts TOKEN_MAX) + the instruction

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

// The request fields. A field that does not parse is refused with its own code; divergenceId is optional and simply dropped when invalid.
// Lengths are UTF-16 `.length` (as JavaScript counts them), not Zod's .min/.max, which count code points: an emoji is 2 here.
const lengthIn = (min: number, max: number) => (s: string) => s.length >= min && s.length <= max;
const RequestText = z.string().trim().refine(lengthIn(3, 2000));
const InstructionText = z.string().trim().refine(lengthIn(3, 1000));
const DivergenceId = z.string().refine(lengthIn(0, 200));

const tooLarge = Symbol("tooLarge");
// The body as text, never beyond `limit` bytes: an announced Content-Length over it is refused before reading, a streamed body is cancelled once it passes it.
async function readTextWithinLimit(request: Request, limit: number): Promise<string | typeof tooLarge> {
	const announced = Number(request.headers.get("content-length"));
	if (Number.isFinite(announced) && announced > limit) return tooLarge;
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) { await reader.cancel(); return tooLarge; }
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return new TextDecoder().decode(bytes);
}

/** The JSON body as an object, or null (too large, empty, not JSON, or not a JSON object: an array is refused too). */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
	const text = await readTextWithinLimit(request, BODY_LIMIT);
	if (text === tooLarge || !text) return null;
	let body: unknown;
	try { body = JSON.parse(text); } catch { return null; }
	return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

// Runs the action and answers at once with its frame stream. The preset record (if any) sees every event and is saved after the
// response closed, so the page never waits on it.
// (Only waitUntil is used: it keeps the Worker alive after the response for the preset record.)
type AfterResponse = { waitUntil(promise: Promise<unknown>): void };

function streamed(env: Env, action: Action, ctx: AfterResponse | null): Response {
	const record = action.kind === "create" ? watchPreset(env, action) : null;
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	let open = true;
	writer.closed.catch(() => { open = false; }); // the client went away (the response was cancelled): seen at once, so nothing new launches
	const keepAlive = (promise: Promise<unknown>) => { try { ctx?.waitUntil(promise); } catch {} }; // in-flight Meta calls live on (to be booked) after the response
	const emit = async (event: StreamEvent) => {
		record?.see(event);
		if (!open) return;
		if (event.t === "end") open = false;
		await writer.write(frame(event)).catch(() => { open = false; }); // a failed write = the client went away
	};
	keepAlive(runRemix(env, { ...action, tally: record?.tally ?? null, keepAlive, emit, closed: () => !open })
		.catch(error => console.error("[remix] unhandled", error))
		.finally(() => {
			open = false;
			writer.close().catch(() => {});
			if (record) keepAlive(record.save());
		}));
	return new Response(readable, { headers: STREAM_HEADERS });
}

// The thinking dial: absent (or null) = DEFAULT_THINKING (medium); anything but low | medium | high is refused.
const thinkingOf = (value: unknown): Thinking | null => (value === undefined || value === null ? DEFAULT_THINKING : (THINKING_LEVELS as readonly unknown[]).includes(value) ? (value as Thinking) : null);
const BAD_THINKING = () => fail(400, "bad_thinking", "thinking must be low, medium or high.");

async function create(request: Request, env: Env, ctx: AfterResponse | null): Promise<Response> {
	if (!versionSecretReady(env)) return fail(503, "unavailable", "Live remixing is not configured on this server (VERSION_SECRET).");
	const body = await readBody(request);
	if (!body) return fail(400, "bad_body", "Send a JSON body under 336 KB.");
	if (!isLibraryBook(body.book)) return fail(400, "bad_book", "Unknown book.");
	const text = RequestText.safeParse(body.request);
	if (!text.success) return fail(400, "bad_request", "Describe your remix in 3–2000 characters.");
	const divergenceId = DivergenceId.safeParse(body.divergenceId);
	const thinking = thinkingOf(body.thinking);
	if (!thinking) return BAD_THINKING();
	return streamed(env, { kind: "create", input: { book: body.book, request: text.data, divergenceId: divergenceId.success ? divergenceId.data : null, fast: body.fast === true, thinking } }, ctx);
}

async function fromToken(request: Request, env: Env, kind: "revise" | "redraw", ctx: AfterResponse | null): Promise<Response> {
	if (!versionSecretReady(env)) return fail(503, "unavailable", "Live remixing is not configured on this server (VERSION_SECRET).");
	const body = await readBody(request);
	if (!body) return fail(400, "bad_body", "Send a JSON body under 336 KB.");
	const version = await readVersion(env, body.token);
	if (!version) return fail(400, "bad_token", "This version cannot be changed here (its token is missing or was not made by this service).");
	if (kind === "redraw") return streamed(env, { kind, input: { version, cover: body.cover === true } }, ctx);
	const instruction = InstructionText.safeParse(body.instruction);
	if (!instruction.success) return fail(400, "bad_instruction", "Describe the change in 3–1000 characters.");
	const thinking = thinkingOf(body.thinking);
	if (!thinking) return BAD_THINKING();
	return streamed(env, { kind, input: { version, instruction: instruction.data, fast: body.fast === true, thinking } }, ctx);
}

const executionCtx = (c: { executionCtx: AfterResponse }): AfterResponse | null => { try { return c.executionCtx; } catch { return null; } };

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: (origin, c) => allowedOrigin(c.env, origin), allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 7200 }));
// Starting work needs the site's origin (or a non-browser client): no other page can spend the model credits through a visitor's browser.
app.use("/api/remix/*", async (c, next) => (c.req.method === "POST" && !trustedOrigin(c.req.raw, c.env) ? fail(403, "cross_origin", "Live actions come from the studio page only.") : next()));
app.use("/api/remix", async (c, next) => (c.req.method === "POST" && !trustedOrigin(c.req.raw, c.env) ? fail(403, "cross_origin", "Live actions come from the studio page only.") : next()));
app.use("/api/share", async (c, next) => (c.req.method === "POST" && !trustedOrigin(c.req.raw, c.env) ? fail(403, "cross_origin", "Sharing comes from the studio page only.") : next()));
// One client may not start more than its share (clientLimits.ts): refused with a 429 before anything is sent.
const limited = (model: boolean) => async (c: { req: { method: string; raw: Request }; env: Env }, next: () => Promise<void>) => {
	if (c.req.method !== "POST") return next();
	const refusal = await limitRefusal(c.req.raw, c.env, { model });
	if (!refusal) return next();
	return Response.json({ error: { code: refusal.code, message: refusal.message, retryable: true } }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(refusal.retryAfterS) } });
};
app.use("/api/remix/*", limited(true)); // Hono's /api/remix/* also matches /api/remix itself: registered once, counted once
app.use("/api/share", limited(false));

app.get("/api/health", async c => {
	const capped = (Object.keys(PROVIDERS) as ProviderId[]).map(provider => budgetOf(c.env, provider)).filter((budget): budget is Budget => budget !== null);
	const budgets = Object.fromEntries(await Promise.all(capped.map(async budget => [budget.provider, { capUsd: budget.capUsd, spentUsd: await spentUsd(budget) }] as const)));
	return json({ ok: true, service: "novelspell-remix", version: c.env.CF_VERSION_METADATA?.id || null, models: MODEL_PROFILE, mock: c.env.MOCK === "1", books: libraryBooks().length, budgets });
});
app.post("/api/remix", c => create(c.req.raw, c.env, executionCtx(c)));
app.post("/api/remix/revise", c => fromToken(c.req.raw, c.env, "revise", executionCtx(c)));
app.post("/api/remix/redraw", c => fromToken(c.req.raw, c.env, "redraw", executionCtx(c)));
app.post("/api/share", c => createShare(c.req.raw, c.env));
app.get("/api/share/:id", c => readShare(c.env, c.req.param("id")));
app.get("/api/share-picture/:hash", c => readSharePicture(c.env, c.req.param("hash")));
app.notFound(() => fail(404, "no_route", "Unknown API route."));
app.onError(error => {
	console.error("[worker] unhandled", error);
	return json({ error: { code: "unavailable", message: "Live remixing hit a temporary problem. Try again in a moment.", retryable: true } }, 503);
});

export default app;
