// The model APIs, faked at the network boundary. The Worker runs in the same isolate as the tests, so replacing fetch here answers
// every call it makes: the writer (POST /responses, Meta or Baseten, as server-sent events) and the illustrator (POST
// /images/generations, Meta). Each test scripts the answers in order; once a script runs out, every call gets a good answer.
// Any other outbound request fails the test: the suite never reaches a real service.
import { vi } from "vitest";

export const SIX_EVENTS = [
	"Victor keeps his promise and finishes the companion.",
	"The creature meets her in the ruined laboratory.",
	"Elizabeth discovers the second creature's existence.",
	"The pair flee north across the frozen sea.",
	"Victor follows, torn between pride and dread.",
	"The creature sends a letter asking to be left in peace.",
];
export const CHAPTER = "The storm broke over Orkney as Victor laid down his tools.\n\n\"It is done,\" he said, and the second heart began to beat.";

export type WriterReply =
	| { kind: "answer"; events?: string[]; chapter?: string; usage?: { input: number; output: number } } // a good streamed answer
	| { kind: "text"; text: string } // this exact answer text, streamed in small deltas
	| { kind: "status"; status: number; retryAfter?: string } // an HTTP error answer
	| { kind: "refusal"; text?: string } // a completed answer that holds only a refusal
	| { kind: "hang" }; // a call that is still reasoning: the stream opens and sends nothing until it is cut
export type ImageReply = { kind: "picture" } | { kind: "status"; status: number; code?: string }; // code: the error code in the body (default fake_<status>)

export interface ModelCall {
	host: string;
	path: string;
	body: Record<string, any>;
	authorization: string | null;
	/** True once the Worker cut this call (its request signal aborted). */
	aborted: boolean;
}

const encoder = new TextEncoder();

/** Replaces fetch for one test. Restore it with `restore()` (or vi.restoreAllMocks()). */
export function fakeModels(script: { writer?: WriterReply[]; images?: ImageReply[] } = {}) {
	const writer = [...(script.writer ?? [])], images = [...(script.images ?? [])];
	const calls: ModelCall[] = [];
	const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		if (!/^(meta|baseten)\.fake$/.test(url.host)) throw new Error(`The suite never calls real services: ${request.method} ${request.url}`);
		const body = await request.json() as Record<string, any>;
		const call: ModelCall = { host: url.host, path: url.pathname, body, authorization: request.headers.get("authorization"), aborted: false };
		calls.push(call);
		init?.signal?.addEventListener("abort", () => { call.aborted = true; });
		if (url.pathname.endsWith("/responses")) return writerAnswer(writer.shift() ?? { kind: "answer" }, init?.signal ?? null);
		if (url.pathname.endsWith("/images/generations")) return imageAnswer(images.shift() ?? { kind: "picture" });
		return Response.json({ error: { code: "not_found" } }, { status: 404 });
	});
	return {
		calls,
		writerCalls: () => calls.filter(call => call.path.endsWith("/responses")),
		imageCalls: () => calls.filter(call => call.path.endsWith("/images/generations")),
		restore: () => spy.mockRestore(),
	};
}

const sse = (events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
const completed = (content: unknown[], usage = { input: 3000, output: 1500 }) => ({
	type: "response.completed",
	response: { status: "completed", output: [{ type: "message", content }], usage: { input_tokens: usage.input, output_tokens: usage.output } },
});

function writerAnswer(reply: WriterReply, signal: AbortSignal | null): Response {
	if (reply.kind === "hang") {
		const body = new ReadableStream<Uint8Array>({ start(controller) {
			controller.enqueue(encoder.encode(sse([{ type: "response.created", response: {} }])));
			signal?.addEventListener("abort", () => controller.error(new DOMException("The call was cut.", "AbortError")));
		} });
		return new Response(body, { headers: { "content-type": "text/event-stream" } });
	}
	if (reply.kind === "status") {
		const headers: Record<string, string> = reply.retryAfter ? { "retry-after": reply.retryAfter } : {};
		return Response.json({ error: { code: `fake_${reply.status}`, message: "Scripted by the test." } }, { status: reply.status, headers });
	}
	if (reply.kind === "refusal") return streamOf(sse([{ type: "response.created", response: {} }, completed([{ type: "refusal", refusal: reply.text ?? "I can't help with that." }])]));
	const text = reply.kind === "text" ? reply.text : JSON.stringify({ events: reply.events ?? SIX_EVENTS, chapter: reply.chapter ?? CHAPTER });
	const deltas: unknown[] = [];
	for (let at = 0; at < text.length; at += 40) deltas.push({ type: "response.output_text.delta", delta: text.slice(at, at + 40) });
	return streamOf(sse([{ type: "response.created", response: {} }, ...deltas, completed([{ type: "output_text", text }], reply.kind === "answer" ? reply.usage : undefined)]));
}

// The body arrives in several network chunks, like a real stream.
function streamOf(text: string): Response {
	const bytes = encoder.encode(text);
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let at = 0; at < bytes.length; at += 512) controller.enqueue(bytes.slice(at, at + 512));
			controller.close();
		},
	});
	return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function imageAnswer(reply: ImageReply): Promise<Response> {
	if (reply.kind === "status") return Response.json({ error: { code: reply.code ?? `fake_${reply.status}`, message: "Scripted by the test." } }, { status: reply.status });
	const png = await picture();
	return Response.json({ created: 0, data: [{ b64_json: btoa(String.fromCharCode(...png)) }] });
}

// A real 16x16 grey PNG (the Worker checks every delivered picture's structure, src/imageCheck.ts).
let cached: Uint8Array | null = null;
export async function picture(): Promise<Uint8Array> {
	if (cached) return cached;
	const size = 16;
	const scanlines = new Uint8Array(size * (size + 1)); // each row: filter byte 0, then 16 grey pixels
	for (let row = 0; row < size; row++) scanlines.fill(128, row * (size + 1) + 1, (row + 1) * (size + 1));
	const idat = new Uint8Array(await new Response(new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
	const ihdr = new Uint8Array(13);
	new DataView(ihdr.buffer).setUint32(0, size);
	new DataView(ihdr.buffer).setUint32(4, size);
	ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale, no interlace
	const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
	const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let at = 0;
	for (const part of parts) { out.set(part, at); at += part.length; }
	return (cached = out);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(encoder.encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

function crc32(bytes: Uint8Array): number {
	let crc = ~0;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return ~crc >>> 0;
}
