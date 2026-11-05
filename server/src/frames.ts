// The response stream of an action: one binary frame per event, written while the request lives.
//   [u32 header length][header: the event as JSON, UTF-8][u32 body length][body]      (lengths big-endian)
// An image event's body is its raw bytes (no base64: a quarter fewer bytes on the wire and no decode pass in the page); every other
// event has an empty body. Nothing is written after `end`; no `end` frame means the connection dropped.
import type { ChapterView } from "./remix";
import type { ProviderId } from "./prompts";

export interface EndError {
	code: string;
	message: string;
	stage: "writing" | "images";
	/** The provider that refused our key (401/402/403) or whose spend cap was reached: the action stopped there. */
	provider?: ProviderId;
	/** That provider is Meta: the page shows its showcase state, not an error. (Another provider, e.g. Fast mode's Baseten, is an error the page names.) */
	showcase?: true;
}

/** The models an action uses, for the page's credit line: the writer (absent on a redraw) and the illustrator. */
export interface ActionModels {
	writer?: { provider: ProviderId; model: string; effort: string | null };
	illustrator: { provider: ProviderId; model: string };
}

export type StreamEvent =
	| { t: "accepted"; version: number; divergenceId: string | null; models: ActionModels }
	| { t: "start"; attempt: number; streaming: boolean }
	| { t: "text"; d: string }
	| { t: "image"; id: string; mime: string; width?: number; height?: number; sig: string; bytes: Uint8Array }
	| { t: "discard"; id: string }
	| { t: "chapter"; chapter: ChapterView }
	| { t: "version"; n: number; token: string }
	| { t: "end"; status: "ready"; error?: undefined }
	| { t: "end"; status: "error"; error: EndError };

const encoder = new TextEncoder();

/** Encodes one event as a frame (an image's bytes become the body, everything else the JSON header). */
export function frame(event: StreamEvent): Uint8Array {
	const { bytes, ...header } = event as StreamEvent & { bytes?: Uint8Array };
	const head = encoder.encode(JSON.stringify(header)), body = bytes ?? new Uint8Array(0);
	const out = new Uint8Array(8 + head.length + body.length), view = new DataView(out.buffer);
	view.setUint32(0, head.length);
	out.set(head, 4);
	view.setUint32(4 + head.length, body.length);
	out.set(body, 8 + head.length);
	return out;
}

/** The response headers of every action stream. no-transform: the edge must not compress (and so buffer) the stream. */
export const STREAM_HEADERS = { "content-type": "application/octet-stream", "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff" } as const;
