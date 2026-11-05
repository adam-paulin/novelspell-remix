#!/usr/bin/env node
// The Meta Model API stand-in of the free local mode: it answers the two calls the Worker makes (src/metaClient.ts) from a pack of
// remixes Meta's models already wrote and drew (content/manifest.json + content/files/), so the whole journey runs without any model.
// Plain node:http, no dependencies (Node 22+ or Bun). It only listens on 127.0.0.1 and contains no outbound network code at all.
//   POST /v1/responses           the writer, in the Meta Model API's streaming format: server-sent events (response.created, response.output_text.delta..., response.completed)
//                                streaming {"events":[6],"chapter":"..."} in small deltas over about 15-25 s, events first
//   POST /v1/images/generations  { created, data: [{ b64_json }] }: the chosen remix's cover or comic, after a few seconds
//   GET  /__calls                the call log (every writer/image call: what was asked, what was served, the outcome)
//   POST /__faults               { writer429?, writer503?, writerStall?, writerCut?, image429?, image503?, image400?, imageStall? } probabilities 0..1
//   GET  /__health               { ok, remixes, books, timeScale, faults }
// What is served:
//   create  the book comes from the book map the writer prompt embeds ("slug"), the what-if from the request data it embeds (DATA.request,
//           DATA.divergenceId). Pick: the same request, else the same turning point (closest request), else the closest request, else a
//           fixed pick for that request among the book's remixes.
//   revise  DATA.previous is the chapter as it stands: the remix (and revision) it came from is looked up by its text, and the answer is
//           that remix's next revision (one whose instruction matches first), else another remix of the book; never the same text again.
//           A book with a single version in the pack alternates between it and a remix of another book (the Worker keeps the book:
//           its title, map and token), until the pack holds a revision for it.
//   images  a comic prompt lists the chapter's events: the remix whose events it holds gives its comic. Anything else is a cover: the
//           create whose request the prompt contains gives its remix's cover (else the closest remix of the book in the prompt).
// Env: FAKE_META_PORT (8790; 0 = any free port), FAKE_META_CONTENT (the pack dir, default ./content), FAKE_META_TIME_SCALE (1; 0 = instant),
//      FAKE_META_FAULTS ("writer429=0.2,imageStall=0.1", off by default), FAKE_META_LOG (a JSONL file that gets every call), FAKE_META_KEY
//      (the dummy key the runner passes: the log says whether each call carried it).
import { createServer } from "node:http";
import { readFileSync, statSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOKS_JSON = resolve(HERE, "../../data/books.json"); // the Worker's book data: titles, to recognize a book in a picture prompt
const FAULT_NAMES = ["writer429", "writer503", "writerStall", "writerCut", "image429", "image503", "image400", "imageStall"];

const sleep = ms => new Promise(done => setTimeout(done, Math.max(0, ms)));
const norm = text => String(text ?? "").toLowerCase().normalize("NFKD").replace(/[‘’]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set("the a an and or of to in on at for with from by is was be are were it its his her their this that what if who into as not no he she they them him".split(" "));
const words = text => new Set(norm(text).split(" ").filter(word => word.length > 2 && !STOP.has(word)));
const hash = text => { let h = 2166136261; for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/** How much of `want` (the visitor's words) `have` covers, 0..1 (Dice coefficient over content words). */
function similarity(want, have) {
	const a = words(want), b = words(have);
	if (!a.size || !b.size) return 0;
	let common = 0;
	for (const word of a) if (b.has(word)) common++;
	return (2 * common) / (a.size + b.size);
}

/** The picture's MIME from its signature (the Worker's imageCheck.ts does the full check), or null. */
function mimeOf(bytes) {
	if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (bytes.length > 8 && bytes[0] === 0x89 && bytes.toString("latin1", 1, 4) === "PNG") return "image/png";
	if (bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
	return null;
}

const validAnswer = item => Array.isArray(item?.events) && item.events.length === 6 && item.events.every(event => typeof event === "string" && /\S/.test(event)) && typeof item.chapter === "string" && /\S/.test(item.chapter);

/** The content pack, re-read whenever manifest.json changes (so a pack being filled is picked up without a restart). */
function contentPack(dir) {
	const manifestPath = join(dir, "manifest.json");
	let loadedAt = -1, pack = null;
	const files = new Map(); // path -> { mtime, bytes, b64, mime }
	const load = () => {
		let mtime;
		try { mtime = statSync(manifestPath).mtimeMs; } catch { throw new Error(`No content pack at ${manifestPath}.`); }
		if (pack && mtime === loadedAt) return pack;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const remixes = [], problems = [];
		for (const raw of manifest.remixes ?? []) {
			if (!raw?.id || !raw.book || !validAnswer(raw)) { problems.push(`${raw?.id ?? "?"}: needs id, book, 6 events and a chapter`); continue; }
			const revisions = (raw.revisions ?? []).filter((revision, index) => validAnswer(revision) || (problems.push(`${raw.id} revision ${index}: needs 6 events and a chapter`), false));
			remixes.push({ ...raw, revisions });
		}
		const byBook = new Map(), versions = [];
		for (const remix of remixes) {
			if (!byBook.has(remix.book)) byBook.set(remix.book, []);
			byBook.get(remix.book).push(remix);
			[remix, ...remix.revisions].forEach((answer, index) => versions.push({ remix, rev: index - 1, events: answer.events, chapter: answer.chapter, comic: answer.comic ?? remix.comic }));
		}
		if (problems.length) console.warn(`[fake-meta] skipped in the pack: ${problems.join("; ")}`);
		pack = { remixes, byBook, versions };
		loadedAt = mtime;
		console.log(`[fake-meta] content pack: ${remixes.length} remixes of ${byBook.size} books (${manifestPath})`);
		return pack;
	};
	const file = relative => {
		if (!relative) return null;
		const path = resolve(dir, relative);
		let mtime;
		try { mtime = statSync(path).mtimeMs; } catch { return null; }
		const cached = files.get(path);
		if (cached?.mtime === mtime) return cached;
		const bytes = readFileSync(path);
		const entry = { mtime, bytes, b64: bytes.toString("base64"), mime: mimeOf(bytes), path };
		if (!entry.mime) { console.warn(`[fake-meta] not a PNG, JPEG or WebP: ${path}`); return null; }
		files.set(path, entry);
		return entry;
	};
	return { load, file };
}

function bookTitles() {
	try {
		const data = JSON.parse(readFileSync(BOOKS_JSON, "utf8"));
		return new Map((data.books ?? []).map(book => [book.slug, book.title]));
	} catch { return new Map(); }
}

/** The JSON object spliced into a text (the writer prompt's DATA block), or null. */
function embeddedJson(text) {
	const start = text.indexOf("{"), end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function parseFaults(spec) {
	const faults = {};
	for (const part of String(spec ?? "").split(",").map(item => item.trim()).filter(Boolean)) {
		const [name, value = "1"] = part.split("=");
		if (!FAULT_NAMES.includes(name)) { console.warn(`[fake-meta] unknown fault ${name} (known: ${FAULT_NAMES.join(", ")})`); continue; }
		faults[name] = Math.min(1, Math.max(0, Number(value) || 0));
	}
	return faults;
}

export async function startFakeMeta({
	port = Number(process.env.FAKE_META_PORT ?? 8790),
	contentDir = process.env.FAKE_META_CONTENT || join(HERE, "content"),
	timeScale = process.env.FAKE_META_TIME_SCALE === undefined || process.env.FAKE_META_TIME_SCALE === "" ? 1 : Number(process.env.FAKE_META_TIME_SCALE),
	faults = parseFaults(process.env.FAKE_META_FAULTS),
	logFile = process.env.FAKE_META_LOG || null,
	key = process.env.FAKE_META_KEY || null,
	quiet = false,
} = {}) {
	const pack = contentPack(resolve(contentDir));
	pack.load(); // fail at start, not on the first call, when the pack is missing
	const titles = bookTitles();
	const scale = Number.isFinite(timeScale) && timeScale >= 0 ? timeScale : 1;
	const wait = ms => (scale ? sleep(ms * scale) : Promise.resolve());
	const calls = [];
	const creates = []; // the recent creates: { at, book, request, remix } (a cover is matched to its create by the request it shows)
	const rotation = new Map(); // book -> how many times another remix of it was picked
	const served = []; // the recent writer answers: { remix, rev } (two remixes may share events: a comic goes to the one just written)
	const open = new Set();
	const roll = name => Math.random() < (faults[name] ?? 0);

	const log = call => {
		calls.push(call);
		if (calls.length > 2000) calls.splice(0, calls.length - 2000);
		if (logFile) { try { appendFileSync(logFile, `${JSON.stringify(call)}\n`); } catch {} }
		if (!quiet) console.log(`[fake-meta] ${call.type}${call.kind ? ` ${call.kind}` : ""} ${call.action ?? ""} ${call.book ?? "?"} -> ${call.remix ?? "-"}${call.rev >= 0 ? ` rev ${call.rev}` : ""} (${call.by ?? ""}) ${call.outcome}`);
	};
	const authOf = req => { const value = String(req.headers.authorization ?? ""); return !value ? "missing" : key && value === `Bearer ${key}` ? "dummy" : "other"; };

	const known = slug => pack.load().byBook.has(slug) || titles.has(slug);
	/** The book a prompt is about: the map's "slug", else a book slug or title it names. */
	function bookIn(text) {
		for (const match of text.matchAll(/"slug"\s*:\s*"([^"]+)"/g)) if (known(match[1])) return match[1];
		for (const [slug, title] of titles) if (text.includes(`"${title}"`)) return slug; // a picture prompt quotes the book's title
		const lower = norm(text);
		for (const slug of pack.load().byBook.keys()) if (text.includes(slug) || (titles.get(slug) && lower.includes(norm(titles.get(slug))))) return slug;
		for (const [slug, title] of titles) if (lower.includes(norm(title))) return slug;
		return null;
	}
	const poolOf = book => { const { byBook, remixes } = pack.load(); return byBook.get(book)?.length ? { pool: byBook.get(book), fallback: false } : { pool: remixes, fallback: true }; };

	/** The remix a create gets -> { remix, by }. */
	function pickCreate(book, request, divergenceId) {
		const { pool, fallback } = poolOf(book);
		if (!pool.length) return null;
		const same = pool.find(remix => norm(remix.request) === norm(request));
		if (same && (!divergenceId || !same.divergenceId || same.divergenceId === divergenceId)) return { remix: same, by: "request" };
		const best = list => list.map(remix => ({ remix, score: similarity(request, remix.request) })).sort((a, b) => b.score - a.score)[0];
		const atPoint = divergenceId ? pool.filter(remix => remix.divergenceId === divergenceId) : [];
		if (atPoint.length) return { remix: best(atPoint).remix, by: "divergence" };
		if (same) return { remix: same, by: "request" };
		const closest = best(pool);
		if (closest.score > 0.15) return { remix: closest.remix, by: "similar" };
		return { remix: pool[hash(`${book}\n${norm(request)}`) % pool.length], by: fallback ? "other-book" : "any" };
	}

	/** The answer a revise gets -> { remix, rev, answer, by }. */
	function pickRevise(book, previous, instruction) {
		const { versions } = pack.load();
		const before = typeof previous?.chapter === "string" ? previous.chapter : "";
		const from = versions.find(version => version.chapter === before) ?? versions.find(version => JSON.stringify(version.events) === JSON.stringify(previous?.events ?? null));
		// A version borrowed from another book (the last fallback below): back to the book's own remixes, so the remix stays that book's.
		const own = book ? (pack.load().byBook.get(book) ?? []).filter(remix => remix.chapter !== before) : [];
		if (from && book && from.remix.book !== book && own.length) return { remix: own[0], rev: -1, answer: own[0], by: "back-to-book" };
		if (from) {
			const later = from.remix.revisions.map((answer, index) => ({ answer, rev: index })).filter(({ rev, answer }) => rev > from.rev && answer.chapter !== before);
			const asked = later.find(({ answer }) => norm(answer.instruction) === norm(instruction)) ?? later[0];
			if (asked) return { remix: from.remix, rev: asked.rev, answer: asked.answer, by: asked === later[0] && norm(asked.answer.instruction) !== norm(instruction) ? "next-revision" : "instruction" };
		}
		const { pool } = poolOf(book ?? from?.remix.book);
		const others = pool.filter(remix => remix !== from?.remix && remix.chapter !== before);
		if (others.length) {
			const turn = rotation.get(book) ?? 0;
			rotation.set(book, turn + 1);
			const remix = others[turn % others.length];
			return { remix, rev: -1, answer: remix, by: "other-remix" };
		}
		// One remix only, its revisions used up: start its chain again with any version whose text differs.
		const remix = from?.remix ?? pool[0];
		const again = [remix, ...remix.revisions].map((answer, index) => ({ answer, rev: index - 1 })).find(({ answer }) => answer.chapter !== before);
		if (again) return { remix, rev: again.rev, answer: again.answer, by: "cycle" };
		// The book has a single version in the pack: a remix of another book (never the same text twice in a row), until the pack has a revision.
		const elsewhere = pack.load().remixes.filter(other => other.chapter !== before);
		const turn = rotation.get("*") ?? 0;
		rotation.set("*", turn + 1);
		const other = elsewhere[turn % elsewhere.length] ?? remix;
		return { remix: other, rev: -1, answer: other, by: "other-book" };
	}

	const json = (res, status, value, headers = {}) => { if (res.destroyed) return; res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(value)); };
	const metaError = (res, status, code, message, headers) => json(res, status, { error: { type: code, code, message } }, headers);
	const gone = res => new Promise(done => { if (res.destroyed || res.writableEnded) done(); res.on("close", done); });

	async function writer(req, res, body) {
		const started = Date.now();
		const instructions = String(body.instructions ?? "");
		const input = (body.input ?? []).map(item => (typeof item?.content === "string" ? item.content : JSON.stringify(item?.content ?? ""))).join("\n");
		const data = embeddedJson(input) ?? {};
		const book = bookIn(instructions) ?? bookIn(input);
		const revise = Boolean(data.previous);
		const call = { type: "writer", action: revise ? "revise" : "create", at: new Date(started).toISOString(), book, request: data.request ?? null, divergenceId: data.divergenceId ?? null, instruction: data.instruction ?? null, model: body.model, stream: body.stream, auth: authOf(req), remix: null, rev: -1, by: null, outcome: "ok", ms: null };
		const finish = outcome => { call.outcome = outcome; call.ms = Date.now() - started; log(call); };
		if (body.stream !== true) return finish("http_400_not_streamed"), metaError(res, 400, "invalid_request", "this fake streams only (stream: true)");
		let picked;
		if (revise) picked = pickRevise(book, data.previous, data.instruction);
		else { const choice = pickCreate(book, data.request ?? "", data.divergenceId ?? null); picked = choice && { ...choice, rev: -1, answer: choice.remix }; }
		if (!picked) return finish("http_500_empty_pack"), metaError(res, 500, "server_error", "the fake's content pack has no remixes");
		Object.assign(call, { remix: picked.remix.id, rev: picked.rev, by: picked.by });
		served.push({ remix: picked.remix, rev: picked.rev }); if (served.length > 200) served.shift();
		if (!revise) { creates.push({ at: started, book, request: String(data.request ?? ""), remix: picked.remix }); if (creates.length > 200) creates.shift(); }
		if (roll("writer429")) { await wait(800); return finish("http_429"), metaError(res, 429, "rate_limit_exceeded", "fake rate limit", { "retry-after-ms": "1500" }); }
		if (roll("writer503")) { await wait(800); return finish("http_503"), metaError(res, 503, "service_unavailable", "fake outage"); }
		const answer = JSON.stringify({ events: picked.answer.events, chapter: picked.answer.chapter });
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		const id = `resp_fake_${started.toString(36)}`;
		const send = event => { if (!res.destroyed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
		send({ type: "response.created", response: { id, status: "in_progress", model: body.model } });
		if (roll("writerStall")) { finish("stalled"); await gone(res); return; }
		await wait(2500); // the model "reasoning" before its first answer text
		// Deltas: the events in about 8 pieces over ~1.5 s, then the prose over 13-22 s (longer chapters take longer), in pieces of a few words.
		const cut = answer.indexOf('"chapter"');
		const proseMs = 13_000 + 9_000 * Math.min(1, (answer.length - cut) / 30_000);
		const pieces = [];
		const split = (from, to, count) => { const size = Math.max(1, Math.ceil((to - from) / count)); for (let at = from; at < to;) { let next = Math.min(to, at + size); if (next < to && /[\ud800-\udbff]/.test(answer[next - 1])) next++; pieces.push([at, next]); at = next; } };
		split(0, cut, 8);
		const eventPieces = pieces.length;
		split(cut, answer.length, Math.max(1, Math.round(proseMs / 60)));
		const cutAt = roll("writerCut") ? eventPieces + Math.floor((pieces.length - eventPieces) / 3) : -1;
		for (let index = 0; index < pieces.length; index++) {
			if (res.destroyed) return finish("client_gone");
			if (index === cutAt) { finish("cut"); res.destroy(); return; }
			send({ type: "response.output_text.delta", item_id: "msg_fake", output_index: 1, content_index: 0, delta: answer.slice(...pieces[index]) });
			if (scale) await wait(index < eventPieces ? 180 : proseMs / (pieces.length - eventPieces));
		}
		const inputTokens = Math.round((instructions.length + input.length) / 4), outputTokens = Math.round(answer.length / 4);
		send({ type: "response.output_text.done", item_id: "msg_fake", output_index: 1, content_index: 0, text: answer });
		send({ type: "response.completed", response: { id, status: "completed", model: body.model, output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: [{ type: "output_text", text: answer }] }], usage: { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: Math.round(outputTokens / 5) } } } });
		res.end();
		finish("ok");
	}

	/** Cover or comic, and the remix whose picture answers this prompt -> { kind, remix, file, by }. */
	async function pictureFor(prompt) {
		const { versions } = pack.load();
		// A comic prompt lists the chapter's events: the version holding most of them (at least 4 of its 6) is the one drawn.
		const scored = versions.map(version => ({ version, hits: version.events.filter(event => prompt.includes(event)).length })).filter(({ hits }) => hits >= 4);
		const top = Math.max(0, ...scored.map(({ hits }) => hits));
		const tied = scored.filter(({ hits }) => hits === top).map(({ version }) => version);
		const recent = [...served].reverse().map(item => tied.find(version => version.remix === item.remix && version.rev === item.rev)).find(Boolean);
		const best = recent ?? tied[0];
		if (best) return { kind: "comic", remix: best.remix, file: best.comic, rev: best.rev, by: recent && tied.length > 1 ? "events+recent" : "events" };
		const book = bookIn(prompt);
		// A cover: its create's request is in the prompt. The cover is sent at the same moment as the writer call, so allow that call a moment to land.
		for (let waited = 0; ; waited += 50) {
			const create = [...creates].reverse().find(item => item.request && (prompt.includes(item.request) || prompt.includes(JSON.stringify(item.request).slice(1, -1))) && (!book || item.book === book));
			if (create) return { kind: "cover", remix: create.remix, file: create.remix.cover, rev: -1, by: "create" };
			if (waited >= 2000) break;
			await sleep(50);
		}
		const { pool, fallback } = poolOf(book);
		const named = pool.find(remix => remix.request && prompt.includes(remix.request));
		const closest = named ?? pool.map(remix => ({ remix, score: similarity(prompt, remix.request) })).sort((a, b) => b.score - a.score)[0]?.remix ?? pool[0];
		return { kind: "cover", remix: closest, file: closest?.cover, rev: -1, by: named ? "request" : fallback ? "other-book" : "similar" };
	}

	async function image(req, res, body) {
		const started = Date.now();
		const prompt = String(body.prompt ?? "");
		const call = { type: "image", kind: null, at: new Date(started).toISOString(), book: bookIn(prompt), size: body.size ?? null, output_format: body.output_format ?? null, auth: authOf(req), remix: null, rev: -1, by: null, file: null, outcome: "ok", ms: null };
		const finish = outcome => { call.outcome = outcome; call.ms = Date.now() - started; log(call); };
		if (body.output_format !== "jpeg" || body.n !== 1) return finish("http_400_shape"), metaError(res, 400, "invalid_request", "this fake answers one jpeg per call (n: 1, output_format: jpeg)");
		const picked = await pictureFor(prompt);
		const file = pack.file(picked?.file);
		Object.assign(call, { kind: picked?.kind ?? null, remix: picked?.remix?.id ?? null, rev: picked?.rev ?? -1, by: picked?.by ?? null, file: picked?.file ?? null });
		if (!file) return finish("http_500_no_file"), metaError(res, 500, "server_error", `the content pack has no ${picked?.kind ?? "picture"} file for ${picked?.remix?.id ?? "this prompt"}`);
		if (roll("imageStall")) { finish("stalled"); await gone(res); return; }
		await wait(picked.kind === "cover" ? 4000 + Math.random() * 2000 : 6000 + Math.random() * 3000);
		if (res.destroyed) return finish("client_gone");
		if (roll("image429")) return finish("http_429"), metaError(res, 429, "rate_limit_exceeded", "fake rate limit", { "retry-after-ms": "1500" });
		if (roll("image503")) return finish("http_503"), metaError(res, 503, "service_unavailable", "fake outage");
		if (roll("image400")) return finish("http_400_policy"), metaError(res, 400, "content_policy_violation", "fake refusal");
		json(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: file.b64 }] });
		finish("ok");
	}

	const server = createServer(async (req, res) => {
		open.add(res); res.on("close", () => open.delete(res));
		const path = new URL(req.url, "http://fake").pathname;
		try {
			const text = req.method === "POST" ? await new Promise((done, fail) => { const parts = []; req.on("data", chunk => parts.push(chunk)); req.on("end", () => done(Buffer.concat(parts).toString("utf8"))); req.on("error", fail); }) : "";
			let body = {};
			try { body = text ? JSON.parse(text) : {}; } catch { return metaError(res, 400, "invalid_json", "the body is not JSON"); }
			if (req.method === "POST" && path === "/v1/responses") return await writer(req, res, body);
			if (req.method === "POST" && path === "/v1/images/generations") return await image(req, res, body);
			if (req.method === "GET" && path === "/__calls") return json(res, 200, { calls });
			if (req.method === "GET" && path === "/__health") { const { remixes, byBook } = pack.load(); return json(res, 200, { ok: true, remixes: remixes.length, books: [...byBook.keys()], timeScale: scale, faults }); }
			if (req.method === "POST" && path === "/__faults") { for (const name of FAULT_NAMES) if (name in body) faults[name] = Math.min(1, Math.max(0, Number(body[name]) || 0)); return json(res, 200, { faults }); }
			log({ type: "unknown", at: new Date().toISOString(), method: req.method, path, outcome: "http_404" });
			metaError(res, 404, "not_found", `${req.method} ${path} is not a Meta Model API call this fake knows`);
		} catch (error) {
			console.error("[fake-meta]", error);
			if (!res.headersSent) metaError(res, 500, "fake_error", String(error?.message ?? error)); else res.destroy();
		}
	});
	await new Promise((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", () => { server.off("error", fail); done(); }); });
	const actual = server.address().port;
	return {
		port: actual,
		base: `http://127.0.0.1:${actual}/v1`,
		calls: () => calls.map(call => ({ ...call })),
		stop: () => new Promise(done => { for (const res of open) res.destroy(); server.close(() => done()); server.closeAllConnections?.(); }),
	};
}

// Run directly: node server.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const fake = await startFakeMeta();
	console.log(`[fake-meta] listening on ${fake.base}`);
	const stop = () => fake.stop().then(() => process.exit(0));
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}

export { FAULT_NAMES };
