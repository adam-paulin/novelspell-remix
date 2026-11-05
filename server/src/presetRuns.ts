// Preset runs: a record of every create that runs a turning point's own preset what-if (the map's divergencePoints[].whatIf, sent
// unchanged with its divergenceId), kept in D1 (migrations/0002_preset_runs.sql) to learn how the presets do: outcome, speed, cost,
// retries, length, and the text and pictures they produced. Write-only: it watches the events the action already sends, writes once
// after the response has closed (ctx.waitUntil), never delays or changes a frame, and a failed write is only logged. Nothing in the API
// reads it; query it with D1 (e.g. SELECT book, divergence_id, status, cost_usd, total_ms FROM preset_runs).
// Pictures are kept for the first PICTURE_RUNS ready runs of each turning point only, which bounds the database's growth.
import { bookMap, type DivergencePoint } from "./books";
import { DEFAULT_THINKING, type Thinking } from "./prompts";
import { ILLUSTRATOR_MODEL, WRITERS, type Env } from "./config";
import type { StreamEvent } from "./frames";
import type { ChapterView } from "./remix";

const PICTURE_RUNS = 2;
// D1 stores one value up to 2,000,000 bytes: a bigger picture is skipped (logged) and the run keeps the others, never the whole batch failing.
const MAX_PICTURE_BYTES = 2_000_000;
const SETTLE_MS = 25_000; // a stopped action can leave a call running (e.g. its cover): wait this long for it, within waitUntil's 30 s after the response

/** Counts the Meta calls of a run: open() when one is sent, close(usd) when its actual cost is booked (metaClient.ts). */
export interface PresetTally {
	open(): void;
	close(usd: number): void;
}

export interface PresetRecord {
	tally: PresetTally;
	see(event: StreamEvent): void;
	save(): Promise<void>;
}

interface CreateInput {
	book: string;
	request: string;
	divergenceId: string | null;
	fast?: boolean;
	thinking?: Thinking;
}

interface Run {
	id: string;
	at: string;
	attempts: number;
	open: number;
	calls: number;
	costUsd: number;
	firstTextMs: number | null;
	chapterMs: number | null;
	chapter: ChapterView | null;
	end: (StreamEvent & { ms: number }) | null;
}

interface Picture {
	mime: string;
	width: number | null;
	height: number | null;
	bytes: Uint8Array;
}

/** A watcher for this action, or null when it is not a preset run (or there is no database to record it in). */
export function watchPreset(env: Env, { kind, input }: { kind: string; input: CreateInput }): PresetRecord | null {
	const db = env.DB;
	if (!db || kind !== "create" || !input.divergenceId) return null;
	let points: DivergencePoint[];
	try { points = bookMap(input.book).divergencePoints ?? []; } catch { points = []; }
	const point = points.find(item => item.id === input.divergenceId);
	if (!point || String(point.whatIf ?? "").trim() !== input.request.trim()) return null;

	const t0 = Date.now(), since = () => Date.now() - t0;
	const run: Run = { id: crypto.randomUUID(), at: new Date(t0).toISOString(), attempts: 0, open: 0, calls: 0, costUsd: 0, firstTextMs: null, chapterMs: null, chapter: null, end: null };
	const pictures = new Map<string, Picture>();
	let wake = () => {};
	const settled = () => (run.open <= 0 ? null : new Promise<void>(resolve => { wake = resolve; setTimeout(resolve, SETTLE_MS); }));
	return {
		tally: { open: () => { run.open++; }, close: usd => { run.open--; run.calls++; run.costUsd += Number(usd) || 0; if (run.open <= 0) wake(); } },
		see(event) {
			if (event.t === "start") run.attempts++;
			else if (event.t === "text" && run.firstTextMs === null) run.firstTextMs = since();
			else if (event.t === "chapter") { run.chapter = event.chapter; run.chapterMs = since(); }
			else if (event.t === "image" && event.bytes) pictures.set(event.id, { mime: event.mime, width: event.width ?? null, height: event.height ?? null, bytes: event.bytes });
			else if (event.t === "discard") pictures.delete(event.id);
			else if (event.t === "end" && !run.end) run.end = { ...event, ms: since() };
		},
		save: () => Promise.resolve(settled()).then(() => save(db, input, run, pictures)).catch(error => console.error("[preset runs] not recorded", error?.message ?? error)),
	};
}

const writerLabel = (writer: { model: string; effort: string | null }) => `${writer.model}${writer.effort ? ` ${writer.effort}` : ""}`;

async function save(db: D1Database, input: CreateInput, run: Run, pictures: Map<string, Picture>): Promise<void> {
	const end = run.end, chapter = run.chapter;
	const status = end && end.t === "end" && !(end.status === "error" && end.error?.code === "stopped") ? end.status : "left"; // "stopped" = the visitor left
	const error = end && end.t === "end" ? end.error : undefined;
	await db.prepare(`INSERT INTO preset_runs (id, at, book, divergence_id, status, error_code, showcase, attempts, calls, calls_open, cost_usd, first_text_ms, chapter_ms, total_ms,
		words, writer_model, image_model, title, events, chapter) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`).bind(
		run.id, run.at, input.book, input.divergenceId, status, error?.code ?? null, error?.showcase ? 1 : 0, run.attempts, run.calls, Math.max(run.open, 0), Math.round(run.costUsd * 1e6) / 1e6,
		run.firstTextMs, run.chapterMs, end?.ms ?? Date.now() - Date.parse(run.at),
		chapter?.chapter ? chapter.chapter.split(/\s+/).filter(Boolean).length : null,
		writerLabel(WRITERS[input.fast ? "fast" : "normal"][input.thinking ?? DEFAULT_THINKING]), ILLUSTRATOR_MODEL.model,
		chapter?.title ?? null, chapter?.events ? JSON.stringify(chapter.events) : null, chapter?.chapter ?? null,
	).run();
	if (status !== "ready" || !pictures.size) return;
	const kept = await db.prepare("SELECT COUNT(DISTINCT r.id) AS n FROM preset_runs r JOIN preset_pictures p ON p.run_id = r.id WHERE r.book = ?1 AND r.divergence_id = ?2").bind(input.book, input.divergenceId).first<{ n: number }>();
	if ((kept?.n ?? 0) >= PICTURE_RUNS) return;
	const fitting = [...pictures].filter(([id, picture]) => picture.bytes.byteLength <= MAX_PICTURE_BYTES || void console.error(`[preset runs] ${id} not kept: ${picture.bytes.byteLength} bytes is over D1's value limit`));
	if (!fitting.length) return;
	await db.batch(fitting.map(([id, picture]) => db.prepare("INSERT INTO preset_pictures (run_id, id, mime, width, height, bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
		.bind(run.id, id, picture.mime, picture.width, picture.height, picture.bytes.buffer.slice(picture.bytes.byteOffset, picture.bytes.byteOffset + picture.bytes.byteLength))));
}
