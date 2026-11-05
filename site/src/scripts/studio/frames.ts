// An action's response body: a stream of frames read as it arrives: [u32 header length][header JSON][u32 body length][body],
// big-endian (server/README.md, "The frame stream"). Each event is its header; an image's body (its raw bytes) comes along as `parts`, the received
// slices, so the picture becomes a Blob without a copy or a decode. A frame cut by a chunk edge waits for its rest; a damaged header
// is skipped.
import type { Line } from "./types";

export async function* lines(response: Response): AsyncGenerator<Line> {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	const queue: Uint8Array[] = [];
	let queued = 0;
	const take = (n: number): Uint8Array[] => {
		const parts: Uint8Array[] = [];
		while (n > 0) {
			const chunk = queue[0]!;
			if (chunk.length <= n) { parts.push(chunk); queue.shift(); n -= chunk.length; queued -= chunk.length; }
			else { parts.push(chunk.subarray(0, n)); queue[0] = chunk.subarray(n); queued -= n; n = 0; }
		}
		return parts;
	};
	const joined = (parts: Uint8Array[]): Uint8Array => {
		if (parts.length === 1) return parts[0]!;
		const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
		let at = 0;
		for (const part of parts) { out.set(part, at); at += part.length; }
		return out;
	};
	const u32 = (bytes: Uint8Array): number => new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
	const peek = (): number => { const bytes = new Uint8Array(4); let at = 0; for (const chunk of queue) for (let i = 0; i < chunk.length && at < 4; i++) bytes[at++] = chunk[i]!; return u32(bytes); };
	let header: { t?: string } | null = null; // the event once its header is read; body is the length of its body
	let body = 0;
	let ended = false; // the body was read to its close: nothing to cancel (cancelling a finished response logs a net::ERR_ABORTED)
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) { ended = true; return; }
			queue.push(value);
			queued += value.length;
			for (;;) {
				if (!header) {
					if (queued < 4) break;
					const size = peek();
					if (queued < 8 + size) break;
					take(4);
					try { header = JSON.parse(decoder.decode(joined(take(size)))); } catch { header = {}; }
					body = u32(joined(take(4)));
				}
				if (queued < body) break;
				const parts = take(body);
				const line = header;
				header = null;
				if (line?.t) yield (line.t === "image" ? { ...line, parts } : line) as Line;
			}
		}
	} finally { if (!ended) reader.cancel().catch(() => {}); }
}
