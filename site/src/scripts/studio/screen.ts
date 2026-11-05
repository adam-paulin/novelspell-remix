// The remix on screen: the record the page paints (the version being read, its pictures as URLs, where it stands), opening a
// record, landing an action's step, stepping versions, the phase helpers and where focus goes.
import { $, $$, html } from "../lib/dom";
import { chipOf } from "./page-data";
import { dashboard, dom, root, slugs, state } from "./context";
import { urlOf, revokeAll } from "./records";
import { follow, syncFollow, toChapterTop } from "./stream";
import { selectBook } from "./workspace";
import type { Remix, ViewRecord } from "./types";
import { view, type Phase, type PhaseOptions } from "./view";

export const setPhase = (name: Phase, options?: PhaseOptions): void => view.phase(root, name, options);

// ---------- focus ----------
// Keyboard and screen-reader focus follows the action: the masthead heading (the new chapter's start), or the failure.
const heading = () => $("[data-remix-heading]", root);
export const resting = (): boolean => { const active = document.activeElement; return !active || active === document.body || active === heading() || active === $("[data-progress-title]", root); };
export const focusHeading = (): void => heading()?.focus({ preventScroll: true });
// A remix reopened from storage or by its link is shown as it is (data-quiet: its chapter and pictures do not replay their arrival;
// CSS). It ends when its chapter leaves (data-has-result goes) or the visitor starts something (any busy phase).
export const quiet = (): void => root.setAttribute("data-quiet", "");
export function focusFailure(): void {
	if (!resting()) return;
	if (root.hasAttribute("data-has-result")) dom.instruction.focus({ preventScroll: true }); else $("[data-progress-title]", root)?.focus({ preventScroll: true });
}

// The original chapter a remix splits from (the split line opens the reader there): a remix on screen speaks for itself (its
// chapter's split, else its own turning point); the composer's picked turning point only counts before a record.
export function divergenceChapter(): string | null {
	const recorded = seen()?.chapter?.divergence?.chapterId ?? null;
	if (recorded && root.hasAttribute("data-has-result")) return recorded;
	const point = state.record ? state.record.divergenceId : state.divergenceId;
	const chip = chipOf(root, state.book, point);
	return chip?.dataset.chapterId || recorded;
}
/** A create that could not make a chapter: the card says why, the what-if stays (Try again writes it again). */
export function fail(kind: string): void {
	setPhase("error", { titleKey: kind, hint: kind });
	root.setAttribute("data-error", kind);
	focusFailure();
}

// ---------- the record on screen ----------
// The version being read (the current one unless the visitor stepped back) with its pictures as URLs, and where the remix stands
// (state.status). While a create or revise is still writing, the pictures and the version number follow its unsaved version and the
// chapter stays the previous one.
export function shown(record: Remix): ViewRecord {
	const pending = state.run?.op === state.op && !state.run.committed ? state.run.entry : null;
	const latest = record.versions.at(-1);
	const entry = pending ? latest : record.versions.find((item) => item.n === state.viewing) ?? latest;
	const now = pending ?? entry;
	const viewing = !pending && entry !== latest;
	return {
		id: record.id, book: record.book, request: record.request, divergenceId: record.divergenceId, featured: record.featured, shared: record.shared, provenance: now?.provenance ?? record.provenance,
		versions: record.versions, version: now?.n ?? 1, latest: pending?.n ?? latest?.n ?? 1, instruction: view.said(now), asked: now?.instruction ?? "", preview: now?.preview,
		chapter: entry?.chapter, images: { comic: urlOf(now?.comic), cover: urlOf(record.cover) },
		viewing, status: viewing ? "ready" : state.status, error: viewing ? null : state.error,
	};
}
/** What the visitor is reading, once the remix has a saved version. */
export const seen = (): ViewRecord | null => (state.record?.versions.length ? shown(state.record) : null);
export function paint(): Phase {
	const record = shown(state.record!);
	const phase = view.apply(root, record, state.revising);
	syncViewing(record);
	return phase;
}
/** A remix at rest (opened from the store): its comic is there, or it never landed (the chapter is fine; Redraw offers it again). */
function settle(record: Remix): void {
	const drawn = record.featured || record.versions.at(-1)?.comic;
	Object.assign(state, { status: drawn ? "ready" : "error", error: drawn ? null : { stage: "images" } });
}
export function open(record: Remix): Phase {
	revokeAll();
	Object.assign(state, { record, id: record.id, viewing: null, run: null, revising: false });
	view.rendered = "";
	if (slugs.includes(record.book) && record.book !== state.book) selectBook(record.book, { keep: true });
	html.toggleAttribute("data-featured", !!record.featured);
	settle(record);
	return paint();
}
// A revision that just landed: the pane goes to the first paragraph that differs from the previous version, which is marked for a moment.
function markChange(previous: string, record: ViewRecord | null): void {
	const blocks = (text: string | undefined) => String(text ?? "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
	const before = blocks(previous);
	const after = blocks(record?.chapter?.chapter);
	const index = after.findIndex((block, i) => block !== before[i]);
	const node = index >= 0 ? $("[data-prose]", root)?.children[index] : null;
	if (!node) return;
	node.setAttribute("data-changed", "");
	if (dashboard.matches && dom.page) dom.page.scrollTo({ top: Math.max(0, node.getBoundingClientRect().top - dom.page.getBoundingClientRect().top + dom.page.scrollTop - dom.page.clientHeight * 0.25), behavior: "instant" });
	else node.scrollIntoView({ block: "center", behavior: "instant" });
	setTimeout(() => node.removeAttribute("data-changed"), 7200);
	// A free demo that served a different change than the one typed says so in the dock for a while (the pane top has the same note).
	if (root.hasAttribute("data-revise-note")) { root.setAttribute("data-note-live", ""); setTimeout(() => root.removeAttribute("data-note-live"), 9000); }
}
// Paints a step of an action. The chapter replacing the streamed text is the same chapter: it lands in place. A reader who followed
// the stream to the end (never scrolled away) is eased back to the chapter's start, where the split line is; one who scrolled keeps
// their place. Phones never moved the page, so they are left where they are.
export function land(): Phase {
	const revisedFrom = state.revising ? state.previousText : null;
	const before = view.rendered;
	const streamed = before.startsWith("stream:");
	const phase = paint();
	if (view.rendered !== before && !streamed) toChapterTop();
	else if (view.rendered !== before && streamed && dashboard.matches && !follow.scrolled && dom.page && dom.page.scrollTop > 0) {
		// Never a long smooth scroll back up: jump, and let the landed text fade in.
		dom.page.scrollTo({ top: 0, behavior: "instant" });
		root.setAttribute("data-landing", "");
		setTimeout(() => root.removeAttribute("data-landing"), 320);
	}
	if (revisedFrom != null && (phase === "ready" || phase === "illustrating") && view.rendered !== before) markChange(revisedFrom, seen());
	syncFollow();
	return phase;
}

// ---------- versions (the saved ones, oldest first) ----------
const browsable = (record: Remix | null): record is Remix => !!record?.versions.length && (state.status === "ready" || state.status === "error");
// An older version is read-only: the dock offers the way back, and Share and Build (which act on the latest) are inert.
function syncViewing(record: ViewRecord | null): void {
	root.toggleAttribute("data-viewing-old", !!record?.viewing);
	if (record?.viewing) for (const node of $$("[data-needs-result], [data-needs-ready]", root)) node.setAttribute("aria-disabled", "true");
	view.cover(root, record);
}
export function showVersion(version: number | null): void {
	const record = state.record;
	if (!browsable(record)) return;
	state.viewing = version === record.versions.at(-1)!.n ? null : version;
	paint();
	dom.page?.scrollTo({ top: 0, behavior: "instant" });
	const reading = $("[data-studio] [data-version-wrap]", document);
	if (reading && !reading.hidden) reading.querySelector<HTMLElement>(state.viewing == null ? "[data-version-prev]" : "[data-version-next]")?.focus({ preventScroll: true });
}
export function stepVersion(direction: number): void {
	const numbers = (state.record?.versions ?? []).map((item) => item.n);
	const target = numbers[numbers.indexOf(state.viewing ?? numbers.at(-1)!) + direction];
	if (target != null) showVersion(target);
}
