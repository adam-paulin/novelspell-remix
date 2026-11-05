// Calls the Worker the way the studio page does and decodes its answer: a refusal is JSON, an action is a stream of binary frames
// (src/frames.ts: [u32 header length][JSON header][u32 body length][body], an image's body being its bytes).
import { exports } from "cloudflare:workers";
import type { StreamEvent } from "../src/frames";

/** The studio's origin (vitest.config.ts SITE_ORIGINS): only it may start work. */
export const ORIGIN = "https://studio.test";

export type Frame = StreamEvent & { bytes?: Uint8Array };

export const get = (path: string) => exports.default.fetch(new Request(`${ORIGIN}${path}`));

export const post = (path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
	exports.default.fetch(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

/** Runs an action to its end: its HTTP status and every frame it streamed. */
export async function act(path: string, body: unknown): Promise<{ status: number; frames: Frame[] }> {
	const response = await post(path, body);
	if (!response.headers.get("content-type")?.includes("octet-stream")) throw new Error(`Expected a frame stream, got ${response.status} ${await response.text()}`);
	return { status: response.status, frames: decode(new Uint8Array(await response.arrayBuffer())) };
}

export function decode(bytes: Uint8Array): Frame[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), decoder = new TextDecoder(), frames: Frame[] = [];
	for (let at = 0; at < bytes.length;) {
		const headLength = view.getUint32(at);
		const header = JSON.parse(decoder.decode(bytes.subarray(at + 4, at + 4 + headLength)));
		const bodyLength = view.getUint32(at + 4 + headLength);
		const body = bytes.subarray(at + 8 + headLength, at + 8 + headLength + bodyLength);
		frames.push(body.length ? { ...header, bytes: body } : header);
		at += 8 + headLength + bodyLength;
	}
	return frames;
}

/** The frame of one type (the first), or undefined. */
export const frameOf = <T extends Frame["t"]>(frames: Frame[], type: T) => frames.find(frame => frame.t === type) as Extract<Frame, { t: T }> | undefined;
/** The prose the reader saw, in order. */
export const proseOf = (frames: Frame[]) => frames.filter(frame => frame.t === "text").map(frame => (frame as { d: string }).d).join("");
