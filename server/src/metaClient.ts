// The model API client: one writer call and one picture call, each validated before it counts as a success, with its billing. Every
// call goes to its model's provider (config.ts PROVIDERS: Meta, or Baseten for Fast mode's writer), which all speak the same API:
//   writer  POST <provider base URL>/responses, streamed (server-sent events). Answer deltas are appended to an in-memory stream that the
//           pipeline reads the moment a line lands. The answer goes through its gate as it streams (answerStream.ts): only events
//           that passed (to the early comic) and then the chapter's prose (to the page) are appended.
//   images  POST <Meta base URL>/images/generations, one picture per job, JPEG from b64_json.
//
// The retry policy, one rule for every call (writer and pictures, every provider; the chain in retryChain.ts runs it):
//   - A failed call is tried again, up to RETRIES (3) more times: a writer answer that is not the { events, chapter } answer (cut at
//     its first wrong character by the gate, before the page sees it; a refusal included), a cut, incomplete or stalled stream (no
//     answer text firstDeltaMs after the call started, or stallMs between deltas), a timeout, a network failure, an unusable picture,
//     a 429 or any 5xx. A 429 or 5xx waits first (backoff, Retry-After honoured up to a minute); everything else is retried at once.
//   - Never retried: a 4xx other than 429 (the request itself was refused), our own bad request. Except a picture 400 that says
//     content_policy_violation: Muse Image refusals are not deterministic and never billed, so they are retried like any failed call.
//   - What bounds it: the spend cap reserves every call before it is sent, and the stage budget (STAGE_BUDGET_MS) ends the chain.
// A Meta 401/402/403 also ends the chain at once (stopsChain), and a launch whose action was stopped meanwhile never reaches the
// network: `halted()` is checked in post(), right before fetch, after every awaited preparation.
// Byte limits (response_too_large): 4 MiB an event, 24 MiB a stream or an image answer; an error answer's body is read up
// to 64 KiB.
import { RoleError, isFatal, asFailure, errorMessage, type Failure, type Usage } from "./errors";
import { reserve, book, actualUsd, type Bill, type Hold } from "./spendCap";
import { MODELS, PROMPTS, TYPICAL_OUTPUT_TOKENS, buildRequest, imageBody as museImageBody, render, type ProviderId, type TextModel } from "./prompts";
import { imageInfo, MAX_EDGE } from "./imageCheck";
import { AnswerFormatError, answerStream } from "./answerStream";
import type { Endpoint, RoleConfig, Price } from "./config";

// The writer watchdog defaults (vars WRITER_FIRST_DELTA_MS, WRITER_STALL_MS). The first answer text comes after the model's
// reasoning: 3-41 s at medium effort, but Muse Wonder at max (the dial's High) reasons for minutes before its first answer text
// (2026-11-04, 30 real max calls: median 168 s, p90 270 s, max 285 s; one of 31 passed 300 s and was cut and paid twice), so the
// first-delta limit leaves room for that, under WRITER_TIMEOUT_MS; deltas then stream continuously.
export const FIRST_DELTA_MS = 480_000, STALL_MS = 30_000;
const encoder = new TextEncoder();

export interface ImageJob {
	id: string;
	prompt: string;
	aspect_ratio: string;
}

export interface DrawnImage {
	id: string;
	mime: string;
	bytes: Uint8Array;
	width: number;
	height: number;
}

/** The illustrator role's result for a set of jobs. */
export interface Illustration {
	images: DrawnImage[];
	provider: string;
	model: string;
	seconds: number;
	attempts: import("./errors").Attempt[];
}

/**
 * The lines a writer call appends to its in-memory stream: start, the events once the answer's opening has passed (answerStream.ts),
 * one `d` per delta of chapter prose, end. Only what passed the gate is ever written here, so the page never sees a rejected opening.
 */
export type StreamLine = { t: "start"; attempt: number; at: number } | { t: "events"; events: string[] } | { t: "d"; v: string } | { t: "end"; attempt: number; ok: boolean };

export interface WriterStreams {
	append(path: string, ...messages: StreamLine[]): void;
}

export interface WriterEntry {
	/** The provider that serves it: the call goes to that provider's endpoint, under its budget. */
	provider: ProviderId;
	model: string;
	/** The model as models.ts sets it (buildRequest's override). */
	spec: TextModel;
	effort: TextModel["effort"];
	price: Price;
}

export interface IllustratorEntry {
	provider: ProviderId;
	model: string;
	perImage: number;
}

/** The chapter answer the writer must return: exactly these two fields. */
export interface ChapterAnswer {
	events: string[];
	chapter: string;
}

/** A launch refused after it was prepared but before it was dispatched: nothing was sent, so nothing is billed. */
export const cancelled = <E extends object>(error: E) => Object.assign(error, { costUsd: 0, billed: false, dispatched: false });

/** A provider's 401/402/403 ends the chain at once: no retry, and no later attempt that might succeed and hide the stop. */
export function stopsChain(error: unknown, provider: string): unknown {
	if (error instanceof RoleError && isFatal({ status: error.status, provider })) { error.retryable = false; error.failover = false; }
	return error;
}

/**
 * The Responses API body of one writer call, built by the prompts (src/prompts), the same function the payload CLI uses: the writer
 * prompt, or the revise prompt for a revise (data.previous), with its role's model from models.ts. Input the prompt refuses is a
 * non-retryable bad_request before anything is sent (so nothing is billed).
 */
export async function writerBody({ info, data, model }: { info: Record<string, unknown>; data: Record<string, unknown>; model?: TextModel }) {
	const prompt = data.previous ? PROMPTS.revise : PROMPTS.writer;
	let rendered;
	try { rendered = render(prompt, { info, data }); } catch (error) { throw cancelled(new RoleError("bad_request", errorMessage(error))); }
	return (await buildRequest(prompt, rendered, model)).body;
}

/** One picture's /images/generations body (src/prompts): the aspect ratio as WxH on the illustrator's short edge. */
export function imageBody({ model, prompt, aspect_ratio }: { model: string; prompt: string; aspect_ratio: string }) {
	try { return museImageBody({ ...MODELS.illustrator, id: model }, prompt, aspect_ratio); } catch (error) {
		if (error instanceof RangeError) throw new RoleError("bad_request", `Meta image: ${error.message}`);
		throw error;
	}
}

function retryAfterMs(response: Response): number | null {
	const after = response.headers.get("retry-after");
	const ms = Number(response.headers.get("retry-after-ms")), seconds = Number(after), date = after ? Date.parse(after) - Date.now() : NaN; // seconds, or an HTTP date
	return Number.isFinite(ms) && ms > 0 ? ms : Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Number.isFinite(date) && date > 0 ? date : null;
}

// The spend cap (spendCap.ts) reserves each call's estimate before it is sent and books the actual cost after. A preset run's tally
// counts the call as open from here until it is booked.
// The hold always carries the call's estimate (a preset run's cost uses it when the billing stays unknown, cap or no cap) and keeps the request
// alive (config.keepAlive = the Worker's waitUntil) until the call is booked, so a booking is never lost when the response ends or the client leaves first.
interface GateHold { estimateUsd: number; budgetHold: Hold | null; settle: () => void }
async function spendGate(config: RoleConfig, endpoint: Endpoint, estimateUsd: number | null | undefined): Promise<GateHold> {
	const hold: GateHold = { estimateUsd: Math.max(Number(estimateUsd) || 0, 0), budgetHold: endpoint.budget ? await reserve(endpoint.budget, estimateUsd ?? null) : null, settle: () => {} };
	config.keepAlive?.(new Promise<void>(resolve => { hold.settle = resolve; }));
	config.tally?.open();
	return hold;
}
async function spendBook(config: RoleConfig, hold: GateHold, bill: Bill): Promise<void> {
	try {
		config.tally?.close(actualUsd(bill, hold.estimateUsd));
		if (hold.budgetHold) await book(hold.budgetHold, bill);
	} finally { hold.settle(); }
}

// No request is sent without a key, so nothing is billed.
function requireKey(endpoint: Endpoint): void {
	if (!endpoint.key) throw Object.assign(new RoleError(`${endpoint.provider}_unconfigured`, `${endpoint.keyVar} is not set on this Worker.`), { costUsd: 0, billed: false });
}
const endpointUrl = (endpoint: Endpoint, path: string) => `${endpoint.baseUrl.replace(/\/+$/, "")}${path}`;

export type Halted = () => Failure | null;

// halted() is checked synchronously right before fetch, so no await can separate the check from the dispatch.
async function post(endpoint: Endpoint, path: string, body: object, timeoutMs: number, label: string, halted: Halted | undefined, signal: AbortSignal | null = null): Promise<Response> {
	requireKey(endpoint);
	const halt = halted?.();
	if (halt) throw cancelled(halt);
	try {
		return await fetch(endpointUrl(endpoint, path), {
			method: "POST",
			headers: { authorization: `Bearer ${endpoint.key}`, "content-type": "application/json", ...((body as { stream?: boolean }).stream ? { accept: "text/event-stream" } : {}) },
			body: JSON.stringify(body),
			signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw failed(error, label, timeoutMs);
	}
}

// A request that got no HTTP answer: a timeout (a slow call) or a network failure.
function failed(error: unknown, label: string, timeoutMs: number): RoleError {
	if (error instanceof RoleError) return error;
	const name = (error as Error)?.name;
	if (name === "TimeoutError" || name === "AbortError") return new RoleError("timeout", `No answer from ${label} within ${Math.round(timeoutMs / 1000)} s.`, { retryable: true, failover: true });
	return new RoleError("network_error", `${label} request failed: ${(error as Error)?.message ?? error}`, { retryable: true, failover: true });
}

// A non-2xx answer: a 429 or any 5xx is retryable (Retry-After honoured), any other status final. Meta bills none of them.
async function httpError(response: Response, label: string): Promise<RoleError> {
	let detail: { code?: unknown; type?: unknown; message?: unknown } = {};
	try { detail = JSON.parse((await readText(response, MAX_ERROR_BODY)) ?? "null")?.error ?? {}; } catch {}
	const status = response.status;
	const code = String(detail.code ?? detail.type ?? `http_${status}`);
	const message = `${label} returned ${status} ${code}: ${String(detail.message ?? "").slice(0, 300)}`;
	const error = new RoleError(status === 429 ? "rate_limited" : code, message, { status, retryable: status === 429 || status >= 500, failover: true, retryAfterMs: retryAfterMs(response) });
	return Object.assign(error, { costUsd: 0, billed: false });
}

// Byte limits, far above any real delivery (a writer stream is ~0.2 MB, an image answer ~3 MB): they only stop a runaway answer.
const MAX_FRAME = 4 * 1024 * 1024, MAX_STREAM = 24 * 1024 * 1024, MAX_IMAGE_JSON = 24 * 1024 * 1024, MAX_ERROR_BODY = 64 * 1024;
const tooLarge = (what: string, limit: number) => new RoleError("response_too_large", `${what} exceeded ${Math.round(limit / 1048576)} MiB.`, { retryable: true, failover: true });
const byteLength = (text: string) => encoder.encode(text).length;
// Whether `text` (after `held` bytes) goes over `limit` bytes: UTF-8 size is between length and 3x length, so it is only encoded when that range straddles the limit.
const overBytes = (held: number, text: string, limit: number) => held + text.length > limit || (held + text.length * 3 > limit && held + byteLength(text) > limit);

// The response body as text, never beyond `limit` bytes: the text, or null when the body is larger (the read is cancelled at once).
async function readText(response: Response, limit: number): Promise<string | null> {
	if (!response.body) { const text = await response.text(); return byteLength(text) > limit ? null : text; }
	if (Number(response.headers.get("content-length")) > limit) { response.body.cancel().catch(() => {}); return null; }
	const decoder = new TextDecoder(), pieces: string[] = [];
	const reader = response.body.getReader();
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if ((total += value.length) > limit) return null;
			pieces.push(decoder.decode(value, { stream: true }));
		}
	} finally {
		reader.cancel().catch(() => {});
	}
	pieces.push(decoder.decode());
	return pieces.join("");
}

/** The terminal Responses API object (response.completed / incomplete / failed), unvalidated. */
type Reply = Record<string, unknown> & { status?: string; output?: unknown; usage?: Record<string, unknown> & { input_tokens_details?: { cached_tokens?: unknown }; output_tokens_details?: { reasoning_tokens?: unknown } }; incomplete_details?: { reason?: string } };
type StreamFailure = { code?: string; message?: string } | null;

// Server-sent events: answer deltas (response.output_text.delta) and the terminal response. The terminal event ends the read, so a
// socket that fails after it (or a server that never closes) cannot discard the finished answer and its usage. Lines are framed
// incrementally: a CR at the end of a chunk waits for the next one (a CRLF split across chunks is one line break).
async function readEvents(response: Response, onDelta: (delta: string) => void): Promise<{ reply: Reply | null; failure: StreamFailure }> {
	const decoder = new TextDecoder();
	let parts: string[] = [], held = 0 /* bytes */, last = "", cr = "", total = 0;
	let reply: Reply | null = null, failure: StreamFailure = null;
	const parse = (frame: string) => {
		const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
		if (!data || data === "[DONE]") return null;
		try { return JSON.parse(data); } catch { return null; }
	};
	const take = (frames: string[]) => {
		let delta = "";
		for (const frame of frames) {
			if (overBytes(0, frame, MAX_FRAME)) throw tooLarge("An event of the answer stream", MAX_FRAME);
			const event = parse(frame);
			if (event?.type === "response.output_text.delta" && typeof event.delta === "string") delta += event.delta;
			else if (/^response\.(completed|incomplete|failed)$/.test(event?.type ?? "")) reply = event.response;
			else if (event?.type === "error") failure = event;
		}
		if (delta) onDelta(delta);
	};
	const feed = (text: string) => {
		const frames: string[] = [];
		let start = 0;
		if (last === "\n" && text[0] === "\n") { frames.push(parts.join("").slice(0, -1)); parts = []; held = 0; last = ""; start = 1; } // the blank line is split across chunks
		for (let end; (end = text.indexOf("\n\n", start)) >= 0; start = end + 2) { frames.push(parts.join("") + text.slice(start, end)); parts = []; held = 0; last = ""; }
		const rest = text.slice(start);
		if (rest) { parts.push(rest); held += byteLength(rest); last = rest.at(-1)!; }
		if (held > MAX_FRAME) throw tooLarge("An event of the answer stream", MAX_FRAME);
		take(frames);
	};
	if (!response.body) throw new TypeError("The answer has no body.");
	const reader = response.body.getReader();
	try {
		while (!reply) {
			const { done, value } = await reader.read();
			if (done) break;
			if ((total += value.length) > MAX_STREAM) throw tooLarge("The answer stream", MAX_STREAM);
			let text = cr + decoder.decode(value, { stream: true });
			cr = text.endsWith("\r") ? "\r" : "";
			if (cr) text = text.slice(0, -1);
			feed(text.replace(/\r\n?/g, "\n"));
		}
		if (!reply) take([parts.join("") + (cr ? "\n" : "") + decoder.decode()]); // a final frame the server did not end with a blank line
	} catch (error) {
		if (!reply || error instanceof RoleError) throw error; // a failure after the terminal event does not cost the answer
	} finally {
		reader.cancel().catch(() => {}); // stop reading; not awaited: a stalled socket must not hold the answer
	}
	return { reply, failure };
}

const usageOf = (reply: Reply | null): Usage | null => {
	const usage = reply?.usage;
	const input = usage?.input_tokens, output = usage?.output_tokens;
	if (typeof input !== "number" || typeof output !== "number" || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
	const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
	const cached = count(usage?.input_tokens_details?.cached_tokens) ?? 0;
	return { input_tokens: input, output_tokens: output, cache_read_tokens: cached, cached_input_tokens: cached, reasoning_tokens: (usage?.output_tokens_details?.reasoning_tokens as number | undefined) ?? null, calls: 1 };
};

const isText = (value: unknown): value is string => typeof value === "string";
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

// The terminal response's containers, checked before they are traversed -> { output, parts } (the message content parts), or null when malformed.
function envelopeOf(reply: unknown): { output: Record<string, unknown>[]; parts: Record<string, unknown>[] } | null {
	if (!isObject(reply)) return null;
	const output = reply.output ?? [], parts: Record<string, unknown>[] = [];
	if (!Array.isArray(output)) return null;
	for (const item of output) {
		if (!isObject(item)) return null;
		if (item.type !== "message") continue;
		const content = item.content ?? [];
		if (!Array.isArray(content)) return null;
		for (const part of content) {
			if (!isObject(part) || (part.type === "output_text" && !isText(part.text))) return null;
			parts.push(part);
		}
	}
	return { output: output as Record<string, unknown>[], parts };
}

// The events every writer answer opens with (writer and revise share the prompts' chapterAnswer schema).
const EVENTS = PROMPTS.writer.output.schema.shape.events;

export interface WriteResult {
	asset: ChapterAnswer;
	usage: Usage | null;
	seconds: number;
	firstDeltaMs: number | null;
}

/** One writer call: streams into `streams` at `path` and returns the validated answer, or throws a RoleError (with `usage` when the answer was billed). */
export async function writeOnce(config: RoleConfig, streams: WriterStreams, { entry, info, data, path, timeoutMs, halted }: { entry: WriterEntry; info: Record<string, unknown>; data: Record<string, unknown>; path: string; timeoutMs: number; halted: Halted | undefined }): Promise<WriteResult> {
	const endpoint = config.endpoints[entry.provider];
	requireKey(endpoint);
	const body = await writerBody({ info, data, model: entry.spec });
	// The reservation, used as the cost only when the billing stays unknown: a typical call (input at ~4 characters a token + the
	// typical output at this effort, models.ts TYPICAL_OUTPUT_TOKENS).
	const estimateUsd = (JSON.stringify(body).length / 4 * entry.price.input + TYPICAL_OUTPUT_TOKENS[entry.effort ?? "none"] * entry.price.output) / 1e6;
	const hold = await spendGate(config, endpoint, estimateUsd);
	const bill: Bill = { billable: true, model: entry.model, price: entry.price };
	try { return await writeCall(config, endpoint, streams, { entry, body, path, timeoutMs, halted }, bill); } finally { await spendBook(config, hold, bill); }
}

async function writeCall(config: RoleConfig, endpoint: Endpoint, streams: WriterStreams, { entry, body, path, timeoutMs, halted }: { entry: WriterEntry; body: Awaited<ReturnType<typeof writerBody>>; path: string; timeoutMs: number; halted: Halted | undefined }, bill: Bill): Promise<WriteResult> {
	const label = `${endpoint.name} ${entry.model}`;
	const started = Date.now();
	streams.append(path, { t: "start", attempt: 1, at: started });
	let reply: Reply | null = null, failure: StreamFailure = null, firstAt: number | null = null;
	// The answer's gate (answerStream.ts): only its validated events and its prose go to the stream the page reads. An opening that goes
	// wrong cuts the call there, so it is retried before the reader has seen anything.
	const answer = answerStream(EVENTS);
	const formatError = (error: AnswerFormatError) => new RoleError("answer_unusable", `${label} ${error.message}.`, { retryable: true, failover: true });
	const read = (delta: string) => {
		let passed;
		try { passed = answer.push(delta); } catch (error) { throw error instanceof AnswerFormatError ? formatError(error) : error; }
		if (passed.events) streams.append(path, { t: "events", events: passed.events });
		if (passed.prose) streams.append(path, { t: "d", v: passed.prose });
	};
	// The watchdog: no answer text firstMs after the call started, or none for stallMs after that, aborts the call as "stalled".
	const watchdog = new AbortController();
	let stalled = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const watch = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { stalled = ms; watchdog.abort(); }, ms); };
	const firstMs = config.writer.firstDeltaMs ?? FIRST_DELTA_MS, stallMs = config.writer.stallMs ?? STALL_MS;
	watch(firstMs);
	// The action stopped while this call runs (the visitor left, or a provider stop): the call is cut within a second, so a chapter
	// nobody will read is not written to its end. Its billing stays unknown (the reservation keeps the estimate).
	let left = false;
	const leaving = halted ? setInterval(() => { if (!left && halted()) { left = true; watchdog.abort(); } }, 1000) : null;
	try {
		const response = await post(endpoint, "/responses", body, timeoutMs, label, halted, watchdog.signal);
		if (!response.ok) { bill.billable = false; throw await httpError(response, label); }
		// A stream cut after the answer began (not the call's own timeout) is an unusable answer. Its billing is unknown.
		({ reply, failure } = await readEvents(response, delta => { firstAt ??= Date.now(); watch(stallMs); read(delta); }).catch(error => {
			if (error instanceof RoleError) throw error; // the gate's format error, an oversized answer
			const cause = failed(error, label, timeoutMs);
			throw cause.code === "timeout" ? cause : new RoleError("answer_unusable", `${label} stream broke: ${(error as Error)?.message ?? error}`, { retryable: true, failover: true });
		}));
	} catch (error) {
		if (asFailure(error)?.billed === false) bill.billable = false; // a non-2xx answer, or a launch cancelled before dispatch
		streams.append(path, { t: "end", attempt: 1, ok: false });
		// an HTTP error keeps its status even when the watchdog cut its body read: a 401/402/403 stays a stop, never a resend
		if (left && !reply && !(error instanceof RoleError && error.status)) throw new RoleError("stopped", `${label} was cut: the action stopped while it was writing.`);
		if (stalled && !reply && !(error instanceof RoleError && error.status)) throw new RoleError("stalled", `${label} sent no answer text for ${Math.round(stalled / 1000)} s.`, { retryable: true, failover: true });
		throw error;
	} finally { clearTimeout(timer); if (leaving) clearInterval(leaving); }
	const usage = usageOf(reply);
	if (usage) bill.usage = usage;
	const reject = (error: RoleError) => {
		streams.append(path, { t: "end", attempt: 1, ok: false });
		return Object.assign(error, usage ? { usage } : {});
	};
	const unusable = (message: string) => reject(new RoleError("answer_unusable", `${label} ${message}`, { retryable: true, failover: true }));
	// A cut stream: the answer is unusable and its billing unknown (no usage), so the spend cap keeps the estimate.
	if (!reply) {
		const cut = failure as StreamFailure;
		throw unusable(`stream ended without a final response${cut ? `: ${cut.code ?? ""} ${cut.message ?? ""}`.trimEnd() : ""}.`);
	}
	// Any answer shape is validated before it is traversed: a malformed envelope is an unusable answer, never an exception.
	const shape = envelopeOf(reply);
	if (!shape) throw unusable("returned a malformed response envelope.");
	const { output, parts } = shape;
	const final: Reply = reply;
	const refusal = parts.find(part => part.type === "refusal");
	if (refusal && !answer.events) throw reject(new RoleError("refused", `${label} refused: ${String(refusal.refusal ?? "").slice(0, 300)}`, { retryable: true, failover: true }));
	if (output.some(item => item.type !== "message" && item.type !== "reasoning")) throw unusable("answered with a tool call.");
	if (final.status !== "completed") throw unusable(`response is ${final.status ?? "incomplete"}${final.incomplete_details?.reason ? ` (${final.incomplete_details.reason})` : ""}.`);
	// A provider that sent the answer only in the final response (no deltas): it goes through the same gate.
	if (firstAt === null) {
		try { read(parts.filter(part => part.type === "output_text").map(part => part.text as string).join("")); } catch (error) { throw reject(error as RoleError); }
	}
	// Past the gate only the prose matters: a chapter string left open by a completed answer still holds the whole chapter.
	if (!answer.events || !/\S/.test(answer.chapter)) throw reject(formatError(new AnswerFormatError(answer.events ? "the answer has a blank chapter" : "the answer has no events")));
	streams.append(path, { t: "end", attempt: 1, ok: true });
	return { asset: { events: answer.events, chapter: answer.chapter }, usage, seconds: (Date.now() - started) / 1000, firstDeltaMs: firstAt ? firstAt - started : null };
}

/** One picture call per job, in parallel (throws a RoleError; a 400 is a content refusal). */
export async function drawOnce(config: RoleConfig, { entry, jobs, timeoutMs, halted }: { entry: IllustratorEntry; jobs: ImageJob[]; timeoutMs: number; halted: Halted }): Promise<DrawnImage[]> {
	const endpoint = config.endpoints[entry.provider];
	const label = `${endpoint.name} ${entry.model}`;
	requireKey(endpoint);
	return Promise.all(jobs.map(async job => {
		const hold = await spendGate(config, endpoint, entry.perImage);
		const bill: Bill = { billable: true, model: entry.model };
		try {
			const image = await drawCall(endpoint, { entry, job, timeoutMs, label, halted, bill });
			bill.costUsd = entry.perImage; // Meta bills a delivered image only
			return image;
		} catch (error) {
			if (!bill.answered) bill.billable = false; // Meta never answered 2xx (a timeout, an abort, an error status): no picture was billed. After a 2xx Meta delivered one, so an unreadable body or a cut download keeps the estimate
			throw error;
		} finally { await spendBook(config, hold, bill); }
	}));
}

async function drawCall(endpoint: Endpoint, { entry, job, timeoutMs, label, halted, bill }: { entry: IllustratorEntry; job: ImageJob; timeoutMs: number; label: string; halted: Halted; bill: Bill }): Promise<DrawnImage> {
	const response = await post(endpoint, "/images/generations", imageBody({ model: entry.model, prompt: job.prompt, aspect_ratio: job.aspect_ratio }), timeoutMs, label, halted);
	if (!response.ok) {
		const error = await httpError(response, label);
		// Muse Image content refusals are not deterministic: the same comic prompt refused once passed on a redraw for 3 of 4 refused
		// featured comics (2026-11-04, Muse Wonder max runs), and a refusal is never billed, so a 400 that says
		// content_policy_violation is retried like any failed call (RETRIES); any other 400 stays final.
		throw response.status === 400 ? Object.assign(new RoleError("content_policy", error.message, { failover: true, retryable: /content_policy_violation/.test(error.message) }), { costUsd: 0, billed: false }) : error;
	}
	bill.answered = true;
	let reply: { data?: { b64_json?: unknown }[] } | null;
	try { reply = JSON.parse(await boundedText(response, MAX_IMAGE_JSON, label)); } catch (error) {
		throw error instanceof SyntaxError ? new RoleError("bad_response", `${label} returned an image answer that is not JSON.`, { retryable: true, failover: true }) : failed(error, label, timeoutMs);
	}
	const b64 = reply?.data?.length === 1 ? reply.data[0]?.b64_json : null;
	if (typeof b64 !== "string") throw new RoleError("bad_response", `${label} returned ${reply?.data?.length ?? 0} images without b64_json; expected exactly one.`, { retryable: true, failover: true });
	return { id: job.id, ...(await imageOf(b64, label)) };
}

// The picture answer's body as text under a byte limit (read as it arrives, so an oversized answer is cut off, not buffered).
async function boundedText(response: Response, limit: number, label: string): Promise<string> {
	const text = await readText(response, limit);
	if (text === null) throw tooLarge(`${label} image answer`, limit);
	return text;
}

// A delivered picture must be valid base64 and a complete PNG, JPEG or WebP of plausible size (imageCheck.ts).
const MIN_EDGE = 16;
async function imageOf(b64: string, label: string): Promise<Omit<DrawnImage, "id">> {
	const bad = (reason: string) => new RoleError("bad_response", `${label} returned an invalid image: ${reason}.`, { retryable: true, failover: true });
	let binary: string;
	try { binary = atob(b64); } catch { throw bad("b64_json is not valid base64"); }
	const bytes = new Uint8Array(binary.length);
	for (let at = 0; at < bytes.length; at++) bytes[at] = binary.charCodeAt(at);
	const info = await imageInfo(bytes);
	if (!info) throw bad(bytes.length ? "not a complete PNG, JPEG or WebP file (bad signature, truncated, missing its end or its pixel data)" : "empty");
	if (!(info.width >= MIN_EDGE && info.height >= MIN_EDGE && info.width <= MAX_EDGE && info.height <= MAX_EDGE)) throw bad(`implausible size ${info.width}x${info.height}`);
	return { mime: info.mime, bytes, width: info.width, height: info.height };
}
