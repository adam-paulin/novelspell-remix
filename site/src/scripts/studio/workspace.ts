// Moving between remixes: choosing a book, the blank workspace, reopening a saved remix (or re-adopting its running action),
// reading a featured remix (compiled in, never fetched) and opening a shared one (?share=<id>: GET /api/share/<id>).
import { $, $$, html } from "../lib/dom";
import { fillSlots, showMessage } from "../lib/messages";
import { safeLocalStorage as local } from "../lib/storage";
import { backToCompose, showCreate } from "./actions";
import { api, BOOK_KEY } from "./constants";
import { dom, live, root, slugs, starting, state, stream, toTop } from "./context";
import { exampleOf, pressPoints } from "./page-data";
import { setInstruction, syncPoint } from "./fields";
import { dropId, readDrafts, readIds, syncUrl } from "./memory";
import { deleteRemix, loadRemix, revokeAll } from "./records";
import { focusHeading, land, open, paint, quiet, resting, setPhase, shown } from "./screen";
import { beginStream, forgetStream, paintSoon } from "./stream";
import type { Remix, Run } from "./types";
import { view, type SharedData } from "./view";

// ---------- choosing a book ----------
export function selectBook(slug: string, { keep = false }: { keep?: boolean } = {}): void {
	if (!slugs.includes(slug)) return;
	const changed = slug !== state.book;
	warmShowcase(slug);
	// The shelf's selection switches in one frame (no transition), so two covers are never highlighted at once.
	if (changed) { html.setAttribute("data-switching", ""); requestAnimationFrame(() => requestAnimationFrame(() => html.removeAttribute("data-switching"))); }
	state.book = slug;
	html.dataset.book = slug;
	local.setItem(BOOK_KEY, slug);
	for (const button of $$("[data-target-book]")) button.setAttribute("aria-pressed", String(button.dataset.targetBook === slug));
	scrollRail(slug, "smooth");
	if (keep) return;
	if (changed) {
		resetWorkspace();
		// A create still waiting for its acceptance is the book's newest remix (no id yet): it comes back before any saved one.
		const pending = starting.get(slug);
		const saved = readIds()[slug];
		if (pending) resume(pending, { push: true });
		else if (saved) restore(saved, { push: true }); else syncUrl(true);
	}
}
// Each book's featured comic is lazy, so a hidden book's page never downloads. Hovering, focusing or picking a book makes only its
// comic eager and decodes it on the pointer's way, so its example fades in whole on the switch (no picture popping in late).
export function warmShowcase(slug: string | undefined): void {
	for (const img of $$<HTMLImageElement>(`[data-classlist~="remix-showcase"][data-book-panel="${slug}"] img`, root)) { img.loading = "eager"; img.decode().catch(() => {}); }
}
// Brings the selected cover into the rail's own scroll box (never the page). Only a cover that is not fully inside the scroll box
// moves it (1px of slack); a fully visible pick never scrolls. The desktop panel scrolls vertically: a cover wholly out of view
// comes to the middle, a partly cut one moves just enough to show whole. The phone and tablet row scrolls horizontally, by the
// same minimal rule.
export function scrollRail(slug: string, behavior: ScrollBehavior): void {
	const item = $(`[data-rail-book="${slug}"]`);
	const list = item?.parentElement;
	if (!item || !list) return;
	const box = list.getBoundingClientRect();
	const rect = item.getBoundingClientRect();
	const gap = 8;
	const away = rect.bottom <= box.top || rect.top >= box.bottom;
	const top = list.scrollHeight <= list.clientHeight + 1 ? 0 : away ? rect.top - box.top - (box.height - rect.height) / 2 : rect.top < box.top - 1 ? rect.top - box.top - gap : rect.bottom > box.bottom + 1 ? rect.bottom - box.bottom + gap : 0;
	const left = list.scrollWidth <= list.clientWidth + 1 ? 0 : rect.left < box.left - 1 ? rect.left - box.left - gap : rect.right > box.right + 1 ? rect.right - box.right + gap : 0;
	if (top || left) list.scrollBy({ top, left, behavior });
}
/** The blank workspace of the book: its draft, else its example (a real value with its turning point picked). */
export function resetWorkspace(): void {
	state.op++;
	forgetStream();
	revokeAll();
	Object.assign(state, { id: null, record: null, revising: false, viewing: null, run: null, status: "ready", error: null });
	view.rendered = "";
	root.removeAttribute("data-viewing-old");
	html.removeAttribute("data-featured");
	root.removeAttribute("data-has-result"); root.removeAttribute("data-quiet");
	root.removeAttribute("data-has-image");
	root.removeAttribute("data-error");
	view.versionReset(root);
	view.share?.(null);
	setPhase("idle");
	const draft = readDrafts()[state.book];
	const start = typeof draft?.text === "string" ? { text: draft.text, divergence: draft.divergence ?? null } : exampleOf(state.book);
	state.divergenceId = start.divergence;
	dom.request.value = start.text;
	pressPoints(root, state.book, state.divergenceId);
	setInstruction("");
}

// ---------- reopening ----------
// Opens the remix this browser saved under `id`, filling the studio's reserved slots when the store answers. An id this browser does
// not have (a stale link, a cleared store) or a remix that never got a chapter falls back to the normal start state, quietly.
export async function restore(id: string, { push = false }: { push?: boolean } = {}): Promise<void> {
	const op = ++state.op;
	state.id = id;
	syncUrl(push);
	setPhase("restoring", { busy: true });
	const running = live.get(id);
	if (running) return adopt(running, op);
	quiet(); // a saved remix: nothing of it replays its arrival
	root.dataset.panels = "0"; // the comic's panel count is not known until the remix is read
	const record = await loadRemix(id);
	if (op !== state.op) return;
	if (record?.versions?.length) { open(record); return; }
	dropId(id);
	root.setAttribute("data-cut", ""); // what the load opened falls back to compose: a cut, not the crossfade (CSS)
	// Nothing was written and nothing is still writing it: the stored copy (and its cover Blob) goes; its what-if is taken back below.
	if (record && !live.has(id)) deleteRemix(id);
	if (record?.request && slugs.includes(record.book)) {
		// An interrupted first create (a reload before its chapter): the composer takes the what-if back.
		selectBook(record.book, { keep: true });
		state.lastPoint = record.divergenceId ?? null;
		backToCompose(record.request);
	} else { resetWorkspace(); syncPoint(); }
	syncUrl();
}
// A remix whose action is still running (left by a book switch or New remix): the page takes the action back (its frames paint
// again from here on) and shows where it stands: the pictures still coming after a saved version, the chapter being written (the
// prose so far repainted, a revision over the version it started from), or the thinking card when no prose arrived yet.
function adopt(run: Run, op: number): void {
	const record = run.record!;
	const { entry } = run;
	run.op = op;
	forgetStream();
	revokeAll();
	view.rendered = "";
	if (slugs.includes(record.book) && record.book !== state.book) selectBook(record.book, { keep: true });
	html.removeAttribute("data-featured");
	root.removeAttribute("data-viewing-old");
	root.removeAttribute("data-error");
	const revising = run.kind === "revise" && !run.committed;
	Object.assign(state, { record, id: record.id, lastId: record.id, viewing: null, run, revising, status: run.committed ? "illustrating" : "writing", error: null });
	if (revising) state.previousText = record.versions.at(-1)?.chapter?.chapter ?? "";
	if (run.committed) { land(); return syncUrl(); }
	if (revising) {
		paint();
		setPhase("writing", { titleKey: "writing", busy: true, revision: true });
	} else {
		root.removeAttribute("data-has-result"); root.removeAttribute("data-quiet");
		root.removeAttribute("data-has-image");
		view.versionReset(root);
		view.tag(root, {});
		fillSlots(root, { request: record.request });
		root.dataset.panels = "0";
		setPhase("writing", { titleKey: "writing", busy: true });
		if (run.accepted) view.early(root, record.book, run.accepted, record.request);
		view.images(root, shown(record));
	}
	if (entry) {
		beginStream(run);
		stream.live!.text = run.text ?? "";
		if (stream.live!.text) paintSoon();
	}
	syncUrl();
}

/** The book's create that was left before it was accepted: the page takes it back (its frames paint again from here on). */
export function resume(run: Run, { push = false }: { push?: boolean } = {}): void {
	run.op = ++state.op;
	state.divergenceId = run.body.divergenceId ?? null;
	dom.request.value = run.body.request!;
	pressPoints(root, state.book, state.divergenceId);
	showCreate(run);
	syncUrl(push);
}

/** The featured remix: painted from the compiled copy, never fetched. */
export function readFeatured(id: string, { push = false }: { push?: boolean } = {}): void {
	const record = view.featured(id);
	if (!record) return;
	forgetStream();
	state.op++;
	state.action = null;
	quiet(); // its pictures are the ones the compose page already showed: no skeleton, no drawing wipe
	open(record);
	syncUrl(push);
	toTop();
	focusHeading();
}

// A shared remix (?share=<id>): read from the API, shown read-only like an example. While it loads the page already is that link
// (Back and Forward compare against it). A link no share has lands on compose with the "isn't here" line; an outage says so and keeps
// the link in the address, so a reload tries again.
export async function openShared(id: string, { push = false }: { push?: boolean } = {}): Promise<void> {
	const op = ++state.op;
	forgetStream();
	state.action = null;
	state.id = `share:${id}`;
	setPhase("restoring", { busy: true });
	quiet();
	root.dataset.panels = "0";
	let record: Remix | null = null;
	let missing = false;
	for (const wait of [0, 1500, 4000]) {
		if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
		if (op !== state.op) return;
		try {
			const response = await fetch(`${api}/api/share/${encodeURIComponent(id)}`);
			if (response.ok) { record = view.sharedRecord((await response.json()) as SharedData); break; }
			if (response.status === 404) { missing = true; break; }
		} catch { /* offline for a moment: try again */ }
	}
	if (op !== state.op) return;
	if (record && slugs.includes(record.book)) {
		open(record);
		syncUrl(push);
		if (resting()) focusHeading();
		return;
	}
	root.setAttribute("data-cut", "");
	resetWorkspace();
	syncPoint();
	const kind = missing || record ? "notFound" : "unreachable";
	if (kind === "notFound") syncUrl();
	root.setAttribute("data-error", kind);
	showMessage($('[data-messages="lost"]', root)!, kind);
	$("[data-lost]", root)?.focus({ preventScroll: true });
}
