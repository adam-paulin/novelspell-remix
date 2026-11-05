// The three actions: create (POST /api/remix), revise (POST /api/remix/revise, with the shown version's token) and redraw
// (POST /api/remix/redraw, a comic that failed to draw). One POST each, only on a visitor's action; its framed response
// (server/README.md, "The frame stream") is handled event by event as it arrives, and every piece is saved as soon as it lands, so an action the
// visitor has left (a book switch, New remix) still finishes into its own remix. The page paints only while the action is the
// page's (run.op === state.op).
import { $, html } from "../lib/dom";
import { fillSlots } from "../lib/messages";
import { pressPoints } from "./page-data";
import { api } from "./constants";
import { hosting, live, root, starting, state, toTop, dom, stream } from "./context";
import { lines } from "./frames";
import { syncPoint, setInstruction } from "./fields";
import { clearDraft, forget, keepId, readFast, readThinking, remember, saveDraft, syncUrl } from "./memory";
import { revoke, revokeAll, saveRemix } from "./records";
import { fail, focusFailure, focusHeading, land, resting, setPhase, shown } from "./screen";
import { publishNow, shareParts } from "./share";
import { beginStream, closeStream, forgetStream, paintSoon, unstream } from "./stream";
import { resetWorkspace } from "./workspace";
import type { Line, RemixError, Run, RunBody } from "./types";
import { view } from "./view";

async function perform(run: Run, path: string, body: RunBody): Promise<void> {
	let settled = false;
	const settle = (error: RemixError | null) => {
		if (settled) return;
		settled = true;
		if (run.record && live.get(run.record.id) === run) live.delete(run.record.id);
		if (run.body.book && starting.get(run.body.book) === run) starting.delete(run.body.book);
		finish(run, error);
		// A version that never committed leaves its early comic unused: free its URL (the page shows the version it started from).
		if (!run.committed) revoke(run.entry?.comic);
	};
	if (run.record) live.set(run.record.id, run);
	try {
		const response = await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
		if (!response.ok) {
			const { error } = ((await response.json().catch(() => null)) ?? {}) as { error?: { code?: string; provider?: string } };
			return settle({ code: error?.code ?? "", stage: "writing", network: response.status >= 500, provider: error?.provider });
		}
		// The end line settles the action at once, but the body is still read to its close: cancelling a response that is not closed
		// yet is logged by the browser as a failed (net::ERR_ABORTED) request.
		for await (const line of lines(response)) {
			if (settled) continue;
			onLine(run, line);
			if (line.t === "end") settle(line.status === "ready" ? null : line.error ?? { code: "", stage: "writing" });
		}
	} catch { /* the connection dropped: no end line, below */ }
	settle({ code: "", stage: "writing", network: true });
}

function onLine(run: Run, line: Line): void {
	const mine = run.op === state.op;
	const { record, entry } = run;
	switch (line.t) {
		case "accepted": {
			if (run.kind === "redraw") break;
			run.entry = { n: line.version, instruction: run.body.instruction, preview: line.preview, chapter: null, token: null, comic: null };
			if (line.models?.writer?.model) run.entry.provenance = { writer: { model: line.models.writer.model }, illustrator: { model: line.models.illustrator?.model } };
			// The streamed prose is kept on the run too, so an action re-adopted mid-chapter repaints what was already written.
			Object.assign(run, { accepted: line, text: "" });
			if (run.kind === "create") {
				const now = Date.now();
				const book = run.body.book!;
				run.record = { id: crypto.randomUUID(), book, request: run.body.request!, divergenceId: line.divergenceId ?? run.body.divergenceId ?? null, createdAt: now, updatedAt: now, cover: null, versions: [] };
				live.set(run.record.id, run);
				saveRemix(run.record);
				// Still its book's create (not left by New remix): the book leads back to it from here on, like a create accepted on screen.
				const owned = starting.get(book) === run;
				if (owned) starting.delete(book);
				if (mine) {
					Object.assign(state, { record: run.record, id: run.record.id, lastId: run.record.id });
					if (line.divergenceId) state.divergenceId = line.divergenceId;
					view.early(root, state.book, line, run.body.request!);
					clearDraft(state.book);
					remember();
				} else if (owned) {
					clearDraft(book);
					keepId(book, run.record.id);
				}
			}
			if (mine) beginStream(run);
			break;
		}
		case "start": run.text = ""; if (mine && stream.live?.text) unstream(); break;
		case "text": run.text = (run.text ?? "") + line.d; if (mine && stream.live) { stream.live.text += line.d; paintSoon(); } break;
		case "image": {
			const remix = record!;
			const version = entry!;
			const image = new Blob(line.parts as BlobPart[], { type: line.mime });
			if (line.id === "cover") { revoke(remix.cover); remix.cover = image; remix.coverSig = line.sig ?? null; } else { revoke(version.comic); version.comic = image; version.comicSig = line.sig ?? null; }
			if (line.id === "cover" || run.committed) { remix.updatedAt = Date.now(); saveRemix(remix); }
			// A version already shared gets the picture on its link (a cover is the whole remix's).
			if (line.sig) for (const item of remix.versions) if (item.shared?.api === api && (line.id === "cover" || item === version)) publishNow(shareParts(remix, item));
			if (mine) view.images(root, shown(remix));
			break;
		}
		case "discard":
			revoke(entry!.comic);
			entry!.comic = null;
			entry!.comicSig = null;
			if (run.committed) saveRemix(record!);
			if (mine) view.images(root, shown(record!));
			break;
		case "chapter": entry!.chapter = line.chapter; break;
		case "version": {
			if (!entry!.chapter) break;
			Object.assign(entry!, { n: line.n ?? entry!.n, token: line.token });
			if (!run.committed) { record!.versions.push(entry!); run.committed = true; }
			record!.updatedAt = Date.now();
			saveRemix(record!);
			if (!mine) break;
			closeStream();
			state.status = "illustrating";
			state.error = null;
			land();
			break;
		}
	}
}

// The action is over: `error` is null (ready) or { code, stage, showcase?, network? } (the end line's error, or a lost connection).
// Whatever landed is already saved. A failure after the version is a comic that did not draw (the chapter is fine); before it,
// nothing new was made: a create has nothing to show, a revise keeps the version it started from.
function finish(run: Run, error: RemixError | null): void {
	if (run.op !== state.op) return;
	const { kind, committed } = run;
	const streamed = view.rendered.startsWith("stream:");
	state.run = null;
	forgetStream();
	if (error?.showcase) hosting.showcase();
	else if (!error) hosting.live();
	if (!error) Object.assign(state, { status: "ready", error: null });
	else if (committed) Object.assign(state, { status: "error", error: { stage: "images", code: error.code } });
	else if (kind === "create") {
		if (error.showcase) { forget(state.book); backToCompose(run.body.request!); return syncUrl(); }
		if (streamed) { root.removeAttribute("data-has-result"); root.removeAttribute("data-quiet"); view.rendered = ""; }
		state.revising = false;
		return fail(view.unavailable(error) ?? (error.network ? "network" : streamed ? "failed" : "notStarted"));
	} else if (error.showcase) { state.revising = false; Object.assign(state, { status: "ready", error: null }); }
	else Object.assign(state, { status: "error", error: { revision: true, stage: "writing", code: error.code, provider: error.provider } });
	const phase = land();
	if (phase === "error") { state.revising = false; return focusFailure(); }
	// A revision that landed: the field is empty again, and focus (lost with the hidden dock) goes back to the new chapter.
	if (state.revising) { setInstruction(""); if (resting()) focusHeading(); }
	state.revising = false;
}

// ---------- creating, revising, redrawing ----------
export async function createRemix(request: string): Promise<void> {
	const op = ++state.op;
	const body: RunBody = { book: state.book, request };
	if (state.divergenceId) body.divergenceId = state.divergenceId;
	if (readFast()) body.fast = true; // Fast mode: Muse Spark Open writes (the field is left out when off)
	body.thinking = readThinking(); // the thinking step, always sent (Medium by default), so the server's own default never decides it
	const run: Run = { op, kind: "create", body, record: null, entry: null, committed: false };
	starting.set(state.book, run);
	showCreate(run);
	focusHeading();
	toTop();
	await perform(run, "/api/remix", body);
}
/** The page of a create not accepted yet (its run is the page's): the writing card, opening at its turning point's chapter. */
export function showCreate(run: Run): void {
	const book = run.body.book!;
	const request = run.body.request!;
	const divergenceId = run.body.divergenceId ?? null;
	state.lastRequest = request;
	state.lastPoint = divergenceId;
	state.lastBook = book;
	state.lastId = null;
	state.revising = false;
	state.viewing = null;
	root.removeAttribute("data-viewing-old");
	state.action = "create";
	forgetStream();
	revokeAll();
	state.record = null;
	state.id = null;
	view.rendered = "";
	root.removeAttribute("data-retitled");
	html.removeAttribute("data-featured");
	root.removeAttribute("data-has-result"); root.removeAttribute("data-quiet");
	root.removeAttribute("data-has-image");
	root.removeAttribute("data-error");
	view.versionReset(root);
	view.tag(root, {});
	fillSlots(root, { request });
	view.images(root, { images: {} });
	root.dataset.panels = "0";
	view.opening = view.splitRef(root, book, divergenceId);
	setPhase("writing", { titleKey: "writing", busy: true });
	Object.assign(state, { run, status: "writing", error: null });
}
/** The last create's request, while the page still shows that create (its book, its remix or none yet); "" otherwise. */
export const ownCreate = (): string => (state.action === "create" && state.lastBook === state.book && (state.lastId ?? null) === (state.id ?? null) ? state.lastRequest : "");
export function backToCompose(request: string): void {
	const point = state.lastPoint;
	resetWorkspace();
	dom.request.value = request;
	state.divergenceId = point;
	pressPoints(root, state.book, point);
	syncPoint();
	saveDraft();
}
export async function reviseRemix(instruction: string): Promise<void> {
	const record = state.record;
	const current = record?.versions.at(-1);
	if (!current?.token || record!.featured) return;
	const op = ++state.op;
	const body: RunBody = { instruction, token: current.token };
	if (readFast()) body.fast = true;
	body.thinking = readThinking();
	const run: Run = { op, kind: "revise", body, record, entry: null, committed: false };
	Object.assign(state, { run, status: "writing", error: null, viewing: null, revising: true, previousText: current.chapter!.chapter ?? "", action: "revise", lastRequest: instruction });
	root.removeAttribute("data-viewing-old");
	root.removeAttribute("data-note-live");
	forgetStream();
	setPhase("writing", { titleKey: "writing", busy: true, revision: true });
	// The masthead's "Changed" line takes its place from the click (not at the first streamed word, which would push the page down).
	const changed = $("[data-changed-head]", root)!;
	fillSlots(changed, { changeText: instruction });
	changed.hidden = false;
	changed.removeAttribute("data-blank");
	focusHeading();
	// The field keeps its text until the revision lands (a failure gives it back untouched).
	await perform(run, "/api/remix/revise", body);
}
/** Draws the current version's comic again (its chapter is fine); a missing cover is drawn with it. */
export async function redrawComic(): Promise<void> {
	const record = state.record;
	const current = record?.versions.at(-1);
	if (!current?.token || record!.featured) return;
	const op = ++state.op;
	const body: RunBody = { token: current.token };
	if (!record!.cover) body.cover = true;
	const run: Run = { op, kind: "redraw", body, record, entry: current, committed: true };
	Object.assign(state, { run, status: "illustrating", error: null, viewing: null });
	root.removeAttribute("data-viewing-old");
	setPhase("illustrating", { titleKey: "writing", busy: true });
	await perform(run, "/api/remix/redraw", body);
}
