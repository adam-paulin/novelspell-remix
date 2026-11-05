// Shared remixes: the one thing a visitor asks the API to keep. A remix lives in its maker's browser; sharing a version publishes a
// read-only snapshot into D1 (migrations/0003_shares.sql + 0004_share_files.sql) that anyone with its link opens.
//   POST /api/share                multipart: token (the signed version) + cover?/comic? (picture files, with a filename) + coverSig?/comicSig?  -> { id }
//   GET  /api/share/:id            { id, at, book, divergenceId, request, n, chapter, pictures: { cover?: { mime, hash }, comic?: { mime, hash } } }
//   GET  /api/share-picture/:hash  a picture's bytes (immutable: the address is the content)
// One link per version: id = base64url(first 16 bytes of SHA-256(token)), so the page knows it before uploading, and a link posted
// while the comic is still drawing gains the pictures when the page sends them (each POST adds or replaces the pictures it carries).
// Nothing unsigned goes in: the text is the token's, and each picture must carry the signature this service put on its image event
// for that slot of that remix. Picture bytes are stored once by hash; SHARE_STORE_CAP_MB caps what all shares may hold.
import { base64url, digestHex, pictureSigned, readVersion } from "./versionToken";
import type { Env } from "./config";
import { eventList } from "./remix";

const BODY_MAX = 12 * 1024 * 1024; // two pictures (a Meta JPEG is about 1 MB) and the token
const PICTURE_MAX = 5 * 1024 * 1024;
const PART = 1_000_000; // D1 keeps a value under 2 MB
const SLOTS = ["cover", "comic"] as const;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);
const DEFAULT_CAP_MB = 400; // under the 500 MB of a free-plan D1 database, with room for the spend row and the preset runs
const encoder = new TextEncoder();

const json = (value: unknown, status = 200, cache = "no-store") => Response.json(value, { status, headers: { "cache-control": cache } });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

type Stored = Record<string, { mime: string; hash: string }>;

/** The share id of a version token (the page computes the same). */
export async function shareId(token: string): Promise<string> {
	return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))).subarray(0, 16));
}
const validId = (id: string | undefined) => /^[A-Za-z0-9_-]{22}$/.test(id ?? "");
const validHash = (hash: unknown) => /^[a-f0-9]{64}$/.test((hash as string) ?? "");
const capBytes = (env: Env) => (Number(env.SHARE_STORE_CAP_MB) > 0 ? Number(env.SHARE_STORE_CAP_MB) : DEFAULT_CAP_MB) * 1024 * 1024;

// The picture's own leading bytes agree with its type (a renamed file is refused).
function looksLike(mime: string, bytes: Uint8Array): boolean {
	const at = (...values: number[]) => values.every((value, i) => bytes[i] === value);
	if (mime === "image/jpeg") return at(0xff, 0xd8, 0xff);
	if (mime === "image/png") return at(0x89, 0x50, 0x4e, 0x47);
	if (mime === "image/webp") return at(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45;
	return new TextDecoder().decode(bytes.subarray(0, 512)).includes("<svg");
}

export async function createShare(request: Request, env: Env): Promise<Response> {
	const db = env.DB;
	if (!db) return fail(503, "unavailable", "Sharing is not available here.");
	const length = Number(request.headers.get("content-length"));
	if (!Number.isFinite(length) || length <= 0 || length > BODY_MAX) return fail(413, "too_large", "Send the remix as one multipart body under 12 MB.");
	let form: FormData;
	try { form = await request.formData(); } catch { return fail(400, "bad_body", "Send the remix as multipart form data."); }
	const token = form.get("token");
	const version = typeof token === "string" ? await readVersion(env, token) : null;
	const events = version ? eventList(version) : [];
	if (!version || typeof version.chapter !== "string" || !events.length) return fail(400, "bad_token", "This version cannot be shared here (its token is missing or was not made by this service).");
	const owner = { book: version.book, request: version.request };
	const pictures: Record<string, { mime: string; bytes: Uint8Array; hash: string }> = {};
	for (const slot of SLOTS) {
		const file = form.get(slot);
		if (!file || typeof file === "string") continue;
		const mime = String(file.type).split(";", 1)[0]!.trim().toLowerCase();
		if (!MIMES.has(mime) || file.size > PICTURE_MAX) return fail(400, "bad_picture", `The ${slot} is not a picture this service sends.`);
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (!looksLike(mime, bytes) || !(await pictureSigned(env, bytes, String(form.get(`${slot}Sig`) ?? ""), { slot, ...owner }))) return fail(400, "bad_picture", `The ${slot} was not drawn by this service for this remix.`);
		pictures[slot] = { mime, bytes, hash: await digestHex(bytes) };
	}
	const id = await shareId(token as string);
	const row = await db.prepare("SELECT pictures FROM shares WHERE id = ?1").bind(id).first<{ pictures: string }>();
	const current: Stored = row ? JSON.parse(row.pictures) : {};
	const changed = Object.entries(pictures).filter(([slot, picture]) => current[slot]?.hash !== picture.hash);
	if (row && !changed.length) return json({ id });

	// New bytes only (a picture already stored for any share is not stored again), within the store's cap.
	const known = new Set<string>();
	for (const [, picture] of changed) if (await db.prepare("SELECT 1 FROM share_files WHERE hash = ?1").bind(picture.hash).first()) known.add(picture.hash);
	const adding = changed.filter(([, picture]) => !known.has(picture.hash));
	if (adding.length) {
		const stored = (await db.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM share_files").first<{ total: number }>())?.total ?? 0;
		if (stored + adding.reduce((sum, [, picture]) => sum + picture.bytes.length, 0) > capBytes(env)) return fail(507, "storage_full", "Shared links are full for now.");
	}
	const now = new Date().toISOString();
	// Only the changed slots are written, merged into the stored value by SQL (json_patch), so two uploads for one share at the same moment both keep their picture.
	const patch: Stored = Object.fromEntries(changed.map(([slot, picture]) => [slot, { mime: picture.mime, hash: picture.hash }]));
	const chapter = { title: version.title ?? null, events, chapter: version.chapter, panels: events.map(beat => ({ beat })) };
	const shown = version.mock?.pick?.request || version.request; // (tokens from a mock deployment carry the what-if they showed)
	// One batch is one transaction: files before their parts (foreign key), the share row last, so a row never names a picture that is not stored.
	const statements: D1PreparedStatement[] = [];
	for (const [, picture] of adding) {
		const parts = Math.ceil(picture.bytes.length / PART);
		statements.push(db.prepare("INSERT OR IGNORE INTO share_files (hash, mime, size, parts, at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(picture.hash, picture.mime, picture.bytes.length, parts, now));
		for (let part = 0; part < parts; part++) statements.push(db.prepare("INSERT OR IGNORE INTO share_blobs (hash, part, bytes) VALUES (?1, ?2, ?3)").bind(picture.hash, part, picture.bytes.slice(part * PART, (part + 1) * PART).buffer));
	}
	statements.push(row
		? db.prepare("UPDATE shares SET pictures = json_patch(pictures, ?2) WHERE id = ?1").bind(id, JSON.stringify(patch))
		: db.prepare("INSERT INTO shares (id, at, book, divergence_id, request, n, chapter, pictures) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (id) DO UPDATE SET pictures = json_patch(shares.pictures, excluded.pictures)")
			.bind(id, now, version.book, version.divergenceId ?? null, String(shown ?? ""), Number(version.n) || 1, JSON.stringify(chapter), JSON.stringify(patch)));
	await db.batch(statements);
	return json({ id });
}

export async function readShare(env: Env, id: string | undefined): Promise<Response> {
	if (!env.DB || !validId(id)) return fail(404, "not_found", "No shared remix has this link.");
	const row = await env.DB.prepare("SELECT id, at, book, divergence_id, request, n, chapter, pictures FROM shares WHERE id = ?1").bind(id).first<{ id: string; at: string; book: string; divergence_id: string | null; request: string; n: number; chapter: string; pictures: string }>();
	if (!row) return fail(404, "not_found", "No shared remix has this link.");
	const stored: Record<string, { mime?: string; hash?: string } | null> = JSON.parse(row.pictures);
	const pictures = Object.fromEntries(Object.entries(stored).filter(([, picture]) => validHash(picture?.hash)).map(([slot, picture]) => [slot, { mime: picture!.mime, hash: picture!.hash }]));
	// Short cache: pictures can still join a link after it was first shared (the picture addresses themselves never change).
	return json({ id: row.id, at: row.at, book: row.book, divergenceId: row.divergence_id, request: row.request, n: row.n, chapter: JSON.parse(row.chapter), pictures }, 200, "public, max-age=60");
}

export async function readSharePicture(env: Env, hash: string | undefined): Promise<Response> {
	if (!env.DB || !validHash(hash)) return fail(404, "not_found", "No such picture.");
	const file = await env.DB.prepare("SELECT mime FROM share_files WHERE hash = ?1").bind(hash).first<{ mime: string }>();
	if (!file) return fail(404, "not_found", "No such picture.");
	const { results } = await env.DB.prepare("SELECT bytes FROM share_blobs WHERE hash = ?1 ORDER BY part").bind(hash).all<{ bytes: ArrayBuffer | number[] }>();
	const parts = results.map(result => new Uint8Array(result.bytes));
	const body = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) { body.set(part, at); at += part.length; }
	// sandbox: a picture opened on its own (an SVG) runs nothing on this origin.
	return new Response(body, { headers: { "content-type": file.mime, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
}
