// Is a delivered picture a complete image file? A Worker has no image codec, so the container is walked and the encoded payload
// checked structurally. A truncated, header-only or pixel-free delivery fails here instead of becoming a "ready" remix with a broken
// picture. CRCs are not verified and pixel content is not judged.
//   PNG   signature, IHDR first (valid colour type / bit depth, 13 bytes), a PLTE for palette images, every chunk inside the buffer, IEND
//         last and at the end of the file, and the IDAT stream inflated: it must inflate cleanly to exactly the scanline bytes IHDR implies
//         (Adam7 pass sizes when interlaced), each scanline starting with a filter byte of 0..4.
//   JPEG  SOI; segments inside the buffer; one start-of-frame with a non-zero size and a consistent component list before the first scan;
//         quantization tables (and Huffman tables for the non-baseline Huffman modes) before it; every SOS header consistent and followed
//         by an entropy-coded segment of at least 2 bytes; EOI as the last two bytes.
//   WebP  RIFF size = file size - 8, every chunk inside it, a first VP8 / VP8L / VP8X chunk and at least one image chunk (or animation
//         frame) with a sound bitstream header. The entropy-coded payload itself is NOT checked (that needs a real decoder).

export interface ImageInfo {
	mime: "image/png" | "image/jpeg" | "image/webp";
	width: number;
	height: number;
}

export const MAX_EDGE = 20_000;
const MAX_RAW_BYTES = 256 * 1024 * 1024; // the largest PNG pixel payload inflated for the check; inflated bytes are only counted, never held

/** { mime, width, height } of a complete PNG, JPEG or WebP, or null. A PNG of implausible size is returned without inflating (the caller rejects it by size). */
export async function imageInfo(bytes: Uint8Array): Promise<ImageInfo | null> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
	if (bytes.length >= 45 && ascii(1, 3) === "PNG" && bytes[0] === 0x89 && ascii(4, 4) === "\r\n\x1a\n") return pngInfo(bytes, view);
	if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpegInfo(bytes, view);
	if (bytes.length >= 26 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return webpInfo(bytes, view);
	return null;
}

const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const; // x start, y start, x step, y step

// Real encoders write IDAT chunks of 8 KiB to 1 MiB; this cap only stops a hostile file made of hundreds of thousands of tiny chunks.
const MAX_IDAT_CHUNKS = 65_536;

/**
 * Whether the zlib stream of the IDAT spans (flat [start, length, ...] into `bytes`, read lazily) inflates cleanly to exactly the
 * scanlines of `segments` ([{ rows, size }], Adam7 passes in order), every scanline starting with a filter byte of 0..4. Reading stops
 * at the first excess byte or bad filter.
 */
async function scanlinesValid(bytes: Uint8Array, spans: number[], segments: { rows: number; size: number }[]): Promise<boolean> {
	let next = 0;
	const source = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (next >= spans.length) return controller.close();
			controller.enqueue(bytes.subarray(spans[next]!, spans[next]! + spans[next + 1]!));
			next += 2;
		},
	});
	let segment = -1, rowsLeft = 0, rowLeft = 0; // rowLeft: bytes of the current scanline still to come (0 = the next byte is a filter byte)
	const reader = source.pipeThrough(new DecompressionStream("deflate")).getReader();
	try {
		for (;;) {
			const { done, value: chunk } = await reader.read();
			if (done) break;
			for (let at = 0; at < chunk.length;) {
				if (rowLeft === 0) {
					if (rowsLeft === 0) { if (++segment >= segments.length) return false; rowsLeft = segments[segment]!.rows; } // a byte beyond the last scanline
					if (chunk[at]! > 4) return false; // PNG filter types are 0 (none) to 4 (Paeth)
					rowsLeft--; rowLeft = segments[segment]!.size - 1; at++;
				} else { const take = Math.min(rowLeft, chunk.length - at); at += take; rowLeft -= take; }
			}
		}
	} catch {
		return false; // cut or corrupt zlib
	} finally {
		reader.cancel().catch(() => {});
	}
	return segment === segments.length - 1 && rowsLeft === 0 && rowLeft === 0; // every scanline arrived
}

// Chunk types compared as 32-bit numbers: the walk allocates nothing per chunk.
const PNG_IHDR = 0x49484452, PNG_PLTE = 0x504c5445, PNG_IDAT = 0x49444154, PNG_IEND = 0x49454e44;
async function pngInfo(bytes: Uint8Array, view: DataView): Promise<ImageInfo | null> {
	const spans: number[] = [];
	let header: { width: number; height: number; depth: number; color: number; compression: number; filter: number; interlace: number } | null = null;
	let palette = false;
	for (let at = 8; at + 12 <= bytes.length;) {
		const length = view.getUint32(at), type = view.getUint32(at + 4), next = at + 12 + length; // length + type + data + CRC
		if (next > bytes.length) return null;
		if (at === 8) {
			if (type !== PNG_IHDR || length !== 13) return null;
			header = { width: view.getUint32(at + 8), height: view.getUint32(at + 12), depth: bytes[at + 16]!, color: bytes[at + 17]!, compression: bytes[at + 18]!, filter: bytes[at + 19]!, interlace: bytes[at + 20]! };
		} else if (type === PNG_PLTE) palette = true;
		else if (type === PNG_IDAT) { // an empty IDAT adds nothing to the stream
			if (length) { if (spans.length >= 2 * MAX_IDAT_CHUNKS) return null; spans.push(at + 8, length); }
		} else if (type === PNG_IEND) {
			if (length !== 0 || next !== bytes.length || !spans.length || !header) return null;
			const { width, height, depth, color, compression, filter, interlace } = header;
			const size: ImageInfo = { mime: "image/png", width, height };
			if (!PNG_DEPTHS[color]?.includes(depth) || compression !== 0 || filter !== 0 || interlace > 1 || (color === 3 && !palette)) return null;
			if (!(width >= 1 && height >= 1 && width <= MAX_EDGE && height <= MAX_EDGE)) return size; // implausible: the caller rejects it, nothing to inflate
			const bits = PNG_CHANNELS[color]! * depth, row = (w: number) => 1 + Math.ceil(w * bits / 8);
			const segments = interlace ? ADAM7.flatMap(([x, y, dx, dy]) => {
				const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
				return w && h ? [{ rows: h, size: row(w) }] : [];
			}) : [{ rows: height, size: row(width) }];
			if (segments.reduce((sum, item) => sum + item.rows * item.size, 0) > MAX_RAW_BYTES) return null;
			return (await scanlinesValid(bytes, spans, segments)) ? size : null;
		}
		at = next;
	}
	return null; // no IEND before the buffer ran out
}

const JPEG_SOF = (marker: number) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
function jpegInfo(bytes: Uint8Array, view: DataView): ImageInfo | null {
	let size: ImageInfo | null = null, frame = 0, tables = 0, huffman = false, scans = 0; // tables: bit 0 = DQT seen, bit 1 = DHT seen
	for (let at = 2; at + 2 <= bytes.length;) {
		if (bytes[at] !== 0xff) return null;
		const marker = bytes[at + 1]!;
		if (marker === 0xff) { at += 1; continue; } // fill byte
		if (marker === 0xd9) return scans > 0 && at + 2 === bytes.length ? size : null; // EOI: the end of the file, after at least one scan
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; } // markers without a segment
		if (at + 4 > bytes.length) return null;
		const length = view.getUint16(at + 2);
		if (length < 2 || at + 2 + length > bytes.length) return null;
		if (JPEG_SOF(marker)) {
			if (size || length < 8) return null; // one frame
			const count = bytes[at + 9]!;
			const height = view.getUint16(at + 5), width = view.getUint16(at + 7);
			if (!bytes[at + 4] || !height || !width || !count || length !== 8 + 3 * count) return null;
			size = { mime: "image/jpeg", width, height };
			frame = marker;
			huffman = ![0xc8, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker); // arithmetic coding has no DHT
		} else if (marker === 0xdb) tables |= 1;
		else if (marker === 0xc4) tables |= 2;
		else if (marker === 0xda) {
			// A scan needs the frame and its tables (DQT unless lossless; DHT for the non-baseline Huffman modes) and a consistent header.
			const lossless = [0xc3, 0xc7, 0xcb, 0xcf].includes(frame);
			if (!size || (!lossless && !(tables & 1)) || (huffman && frame !== 0xc0 && frame !== 0xc1 && !(tables & 2))) return null;
			const components = bytes[at + 4]!;
			if (!components || components > 4 || length !== 6 + 2 * components) return null;
			// The entropy-coded segment runs to the next marker that is not a stuffed 0xFF00, a restart or a fill byte; it must hold data.
			let end = at + 2 + length, data = 0;
			for (; end < bytes.length; end++) {
				if (bytes[end] === 0xff) {
					const next = bytes[end + 1];
					if (next === undefined) return null;
					if (next === 0xff) continue;
					if (next === 0x00) { data += 2; end++; continue; }
					if (next >= 0xd0 && next <= 0xd7) { end++; continue; }
					break;
				}
				data++;
			}
			if (data < 2) return null; // an empty or one-byte scan encodes no picture (a solid colour legitimately repeats one byte)
			scans++;
			at = end;
			continue;
		}
		at += 2 + length;
	}
	return null; // no EOI
}

// Chunk fourcc as big-endian numbers ("VP8 ", "VP8L", "VP8X", "ANMF").
const WEBP_VP8 = 0x56503820, WEBP_VP8L = 0x5650384c, WEBP_VP8X = 0x56503858, WEBP_ANMF = 0x414e4d46;
function webpFrame(bytes: Uint8Array, view: DataView, kind: number, data: number, length: number): { width: number; height: number } | null {
	if (kind === WEBP_VP8) {
		if (length < 11 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
		const tag = bytes[data]! | (bytes[data + 1]! << 8) | (bytes[data + 2]! << 16);
		const width = view.getUint16(data + 6, true) & 0x3fff, height = view.getUint16(data + 8, true) & 0x3fff;
		const first = tag >> 5; // size of the first partition, which follows the 10-byte key frame header; token data follows it
		if ((tag & 1) !== 0 || !width || !height || first < 1 || 10 + first >= length) return null;
		return { width, height };
	}
	if (kind === WEBP_VP8L) {
		if (length < 6 || bytes[data] !== 0x2f || bytes[data + 4]! >> 5 !== 0) return null;
		return { width: 1 + (bytes[data + 1]! | ((bytes[data + 2]! & 0x3f) << 8)), height: 1 + ((bytes[data + 2]! >> 6) | (bytes[data + 3]! << 2) | ((bytes[data + 4]! & 0x0f) << 10)) };
	}
	return null;
}

function webpInfo(bytes: Uint8Array, view: DataView): ImageInfo | null {
	if (view.getUint32(4, true) + 8 !== bytes.length) return null;
	let size: ImageInfo | null = null, image = false, first = true;
	// The chunks of [at, limit): an animation frame (ANMF) holds its own chunks after a 16-byte header.
	const walk = (at: number, limit: number, nested: boolean): boolean => {
		for (; at + 8 <= limit;) {
			const kind = view.getUint32(at), length = view.getUint32(at + 4, true), data = at + 8, end = data + length;
			if (end > limit) return false;
			if (first && !nested) {
				first = false;
				if (kind === WEBP_VP8X) {
					if (length < 10) return false;
					size = { mime: "image/webp", width: 1 + (bytes[data + 4]! | (bytes[data + 5]! << 8) | (bytes[data + 6]! << 16)), height: 1 + (bytes[data + 7]! | (bytes[data + 8]! << 8) | (bytes[data + 9]! << 16)) };
				} else if (kind === WEBP_VP8 || kind === WEBP_VP8L) { const frame = webpFrame(bytes, view, kind, data, length); if (!frame) return false; size = { mime: "image/webp", ...frame }; }
				else return false;
			}
			if (kind === WEBP_VP8 || kind === WEBP_VP8L) { if (!webpFrame(bytes, view, kind, data, length)) return false; image = true; }
			else if (kind === WEBP_ANMF && !nested) { if (length < 16 || !walk(data + 16, end, true)) return false; }
			at = end + (length & 1);
		}
		return true;
	};
	return walk(12, bytes.length, false) && image ? size : null;
}
