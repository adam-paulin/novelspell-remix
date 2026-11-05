// The live chapter. The prose of an action arrives as `text` lines: it is painted at most once a frame through view.stream, and the
// first text leaves the writing card for the chapter. A `start` after text (the writer began again) goes back to where the page was
// before the first text (the thinking card, or the previous version with the dock thinking). The `chapter` line replaces the
// streamed text. On desktop the pane can follow the newest line (`follow`), inside itself only.
import { $ } from "../lib/dom";
import { dashboard, dom, reduceMotion, root, stream } from "./context";
import { seen } from "./screen";
import type { Run } from "./types";
import { view } from "./view";

export function closeStream(): void {
	cancelAnimationFrame(stream.frame);
	stream.frame = 0;
}
export function forgetStream(): void { closeStream(); stream.live = null; root.removeAttribute("data-streaming"); root.removeAttribute("data-split-pending"); }
/** Back from the streamed text: the previous version (a revision) or the thinking card (a first chapter). */
export function unstream(): void {
	if (stream.live) stream.live.text = "";
	if (!view.rendered.startsWith("stream:")) return;
	root.removeAttribute("data-streaming");
	root.removeAttribute("data-split-pending");
	view.rendered = "";
	const previous = seen();
	if (previous) view.result(root, previous); else { root.removeAttribute("data-has-result"); root.removeAttribute("data-quiet"); $("[data-prose]", root)?.replaceChildren(); }
	dom.page?.scrollTo({ top: 0, behavior: "instant" });
}
function paintStream(): void {
	stream.frame = 0;
	const live = stream.live;
	if (!live?.text || root.dataset.phase !== "writing") return;
	// A revision's new version starts at the top (it replaces the chapter that was there): the pane on desktop, the page on a phone,
	// where the pane also keeps at least a screen of height while it streams (CSS), so the shorter new text never pulls the footer
	// or the sticky dock into a new place.
	if (view.stream(root, live)) {
		follow.on = false;
		follow.scrolled = false;
		if (root.hasAttribute("data-revision")) toChapterTop();
	}
	followNow();
	syncFollow();
}
export const paintSoon = (): void => { if (!stream.frame) stream.frame = requestAnimationFrame(paintStream); };
/** The top of the chapter: the pane's own scroll on desktop (the page never scrolls there); the page on a phone. */
export function toChapterTop(): void {
	dom.page?.scrollTo({ top: 0, behavior: "instant" });
	follow.last = 0;
	// A phone: the page comes to the chapter's own top (under the sticky header, its scroll-margin), only when the reader is past it.
	if (!dashboard.matches && dom.page && dom.page.getBoundingClientRect().top < 0) dom.page.scrollIntoView({ block: "start", behavior: "instant" });
}

// Following the stream (desktop): the pane keeps the newest line in view, inside itself only. Each frame closes 30% of the gap, and
// never leaves more than 30 px of it (less than the pane's bottom padding, so the growing line stays visible whatever the frame
// rate). The reader scrolling up (wheel or keys up, a touch or a scrollbar drag that moved the pane up) stops it; coming back within
// 24 px of the bottom resumes it. The browser's own eased wheel scroll can read lower than a frame before, so a decrease alone is not
// the reader. Phones never follow (the page is the reader's to scroll).
export const follow = { on: true, last: 0, frame: 0, up: 0, scrolled: false };
/** One step: called in the frame that painted new text (so the gap never shows above 30 px), then eased on by rAF. */
export function followNow(): void {
	const pane = dom.page;
	if (!follow.on || !pane || !dashboard.matches || !root.hasAttribute("data-streaming")) return;
	const bottom = pane.scrollHeight - pane.clientHeight;
	const gap = bottom - pane.scrollTop;
	if (gap < 1) return;
	pane.scrollTop = reduceMotion.matches ? bottom : Math.max(pane.scrollTop + Math.ceil(gap * 0.3), bottom - 30);
	follow.last = pane.scrollTop;
	followSoon();
}
function followSoon(): void {
	if (follow.frame || !follow.on || !dom.page || !dashboard.matches) return;
	follow.frame = requestAnimationFrame(() => { follow.frame = 0; followNow(); });
}
// Follow is off until the visitor asks for it (the chip): the pane stays at the chapter's opening while it is written. The chip
// shows while text is below the fold and follow is off.
export function syncFollow(): void {
	const pane = dom.page;
	root.toggleAttribute("data-follow", follow.on);
	root.toggleAttribute("data-follow-below", !!pane && pane.scrollHeight - pane.clientHeight - pane.scrollTop > 24);
}
/** The reader's own scrolling of the pane (binds once, at start). */
export function bindFollow(): void {
	const upward = () => { follow.up = performance.now(); };
	dom.page?.addEventListener("wheel", (event) => { if (event.deltaY < 0) upward(); }, { passive: true });
	dom.page?.addEventListener("pointerdown", upward, { passive: true });
	dom.page?.addEventListener("touchstart", upward, { passive: true });
	document.addEventListener("keydown", (event) => { if (["ArrowUp", "PageUp", "Home"].includes(event.key)) upward(); });
	dom.page?.addEventListener("scroll", () => {
		const pane = dom.page!;
		if (!root.hasAttribute("data-streaming")) { follow.last = pane.scrollTop; return; }
		if (pane.scrollTop < follow.last - 2 && performance.now() - follow.up < 1000) { follow.on = false; follow.scrolled = true; cancelAnimationFrame(follow.frame); follow.frame = 0; }
		if (pane.scrollHeight - pane.clientHeight - pane.scrollTop < 24) { follow.on = true; followSoon(); }
		follow.last = pane.scrollTop;
		syncFollow();
	}, { passive: true });
}
/** The live bookkeeping of an action's version (its prose arrives from here on). */
export function beginStream(run: Run): void {
	closeStream();
	const record = run.record!;
	const entry = run.entry!;
	stream.live = { key: `stream:${record.id}:${entry.n}`, text: "", split: view.splitRef(root, record.book, record.divergenceId), version: entry.n, record: { versions: record.versions, version: entry.n, latest: entry.n, instruction: view.said(entry) } };
}
