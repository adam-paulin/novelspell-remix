// Sending, for the CLI only (--send, or payloadOnly off): one request to the API, its streamed answer read and checked, its cost.
// The Worker never uses this file: it sends through its own Meta client (src/metaClient.ts) with retries, watchdogs and the spend cap.
import { imageInfo } from "../src/imageCheck.js";
import { TYPICAL_OUTPUT_TOKENS, checkAnswer, modelOf, type Prompt, type TextModel } from "../src/prompts/index.js";
import { config } from "./config.js";

export interface Request {
	method: "POST";
	url: string;
	body: Record<string, unknown>;
}

/** A rough cost before sending: about 4 characters a token, the output at its usual size for the effort. Labelled an estimate wherever it is shown. */
export function estimateUsd(prompt: Prompt, request: Request): number {
	const model = modelOf(prompt);
	if (model.kind === "image") return model.price.perImage;
	const typicalOutputTokens = TYPICAL_OUTPUT_TOKENS[model.effort ?? "none"];
	const chars = String(request.body.instructions ?? "").length + JSON.stringify(request.body.input ?? "").length;
	return (chars / 4 * model.price.input + typicalOutputTokens * model.price.output) / 1e6;
}

export interface Sent {
	status: number;
	ok: boolean;
	seconds: number;
	/** A JSON answer: the parsed value. */
	answer?: unknown;
	/** An image answer: the picture's bytes. */
	image?: Uint8Array;
	/** Why the answer was refused (bad status, timeout, not JSON, schema or check failure, not a complete picture). */
	problems: string[];
	usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
	costUsd?: number;
}

const errorText = (error: unknown) => (error instanceof Error ? (error.name === "TimeoutError" ? `no answer within ${config.timeoutMs / 1000} s` : error.message) : String(error));

/**
 * Sends one request; never throws for a failed call (the result says why). The key comes from the environment and is never stored.
 * `onStarted` fires once the model starts answering (its first text, or the answer's end): by then the prompt has been read, so its
 * prefix is cached.
 */
export async function send(prompt: Prompt, request: Request, onStarted: () => void = () => {}): Promise<Sent> {
	const key = process.env[config.api.keyEnv];
	if (!key) throw new Error(`Sending needs ${config.api.keyEnv} in the environment.`);
	const started = performance.now();
	const seconds = () => Math.round(performance.now() - started) / 1000;
	const failed = (status: number, problem: string): Sent => ({ status, ok: false, seconds: seconds(), problems: [problem] });
	let response: Response;
	try {
		response = await fetch(request.url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(config.timeoutMs) });
	} catch (error) { onStarted(); return failed(0, errorText(error)); }
	if (!response.ok) { onStarted(); return failed(response.status, `HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 500)}`); }
	const model = modelOf(prompt);
	if (model.kind === "image") {
		let body: { data?: { b64_json?: unknown }[] };
		try { body = await response.json() as typeof body; } catch (error) { return failed(response.status, `The answer is not JSON: ${errorText(error)}`); }
		const b64 = body.data?.length === 1 ? body.data[0]?.b64_json : undefined;
		if (typeof b64 !== "string") return failed(response.status, "The answer does not hold exactly one picture (data[0].b64_json).");
		const image = Buffer.from(b64, "base64");
		// Billed once Meta answered 2xx, even when the picture proves unusable.
		if (!(await imageInfo(image))) return { ...failed(response.status, "The picture is not a complete image file."), costUsd: model.price.perImage };
		return { status: response.status, ok: true, seconds: seconds(), image, problems: [], costUsd: model.price.perImage };
	}
	const { text, usage, problem } = await readStream(response, onStarted);
	const result: Sent = { status: response.status, ok: false, seconds: seconds(), problems: problem ? [problem] : [], ...(usage ? { usage, costUsd: costOf(model, usage) } : {}) };
	if (problem) return result;
	return { ...result, ...checkAnswer(prompt, text) };
}

function costOf(model: TextModel, usage: NonNullable<Sent["usage"]>): number {
	const cached = usage.input_tokens_details?.cached_tokens ?? 0;
	return (Math.max((usage.input_tokens ?? 0) - cached, 0) * model.price.input + cached * model.price.cachedInput + (usage.output_tokens ?? 0) * model.price.output) / 1e6;
}

/**
 * Reads a Responses API event stream up to its terminal event (response.completed, .incomplete or .failed; the connection is then
 * released, whether or not the server closes it): the answer text, the usage, and why it stopped when it did not complete. Usage is
 * kept from whichever terminal event carries it, and a transport error keeps whatever was read, since such a call may be billed.
 */
async function readStream(response: Response, onStarted: () => void): Promise<{ text: string; usage?: Sent["usage"]; problem?: string }> {
	if (!response.body) { onStarted(); return { text: "", problem: "The answer has no body." }; }
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "", text = "", usage: Sent["usage"], problem: string | undefined, ended = false;
	type Event = { type?: string; delta?: string; message?: string; response?: { usage?: Sent["usage"]; incomplete_details?: { reason?: string }; error?: { message?: string } } };
	const take = (frame: string) => {
		const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
		if (!data || data === "[DONE]") return;
		let event: Event;
		try { event = JSON.parse(data) as Event; } catch { problem ??= "The stream sent an event that is not JSON."; return; }
		if (event.type === "response.output_text.delta" && typeof event.delta === "string") { if (!text) onStarted(); text += event.delta; }
		if (event.type === "response.completed") { usage = event.response?.usage; ended = true; }
		if (event.type === "response.incomplete") { usage = event.response?.usage; ended = true; problem = `The answer stopped early (${event.response?.incomplete_details?.reason ?? "no reason given"}).`; }
		if (event.type === "response.failed") { usage = event.response?.usage; ended = true; problem = `The model failed: ${event.response?.error?.message ?? "no message"}.`; }
		if (event.type === "error") problem = `Stream error: ${event.message ?? "no message"}.`;
	};
	try {
		while (!ended) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n"); // a lone trailing \r waits for its \n
			for (let end; !ended && (end = buffer.indexOf("\n\n")) >= 0; buffer = buffer.slice(end + 2)) take(buffer.slice(0, end));
		}
		if (!ended && buffer.trim()) take(buffer);
	} catch (error) {
		problem ??= `The stream broke: ${errorText(error)}`;
	} finally {
		onStarted();
		reader.cancel().catch(() => {});
	}
	if (!ended) problem ??= "The stream ended without a terminal event (response.completed).";
	return { text, ...(usage ? { usage } : {}), ...(problem ? { problem } : {}) };
}
