// The studio's interactions: one delegated click handler (every control is a data-* hook), the two forms and their keys, warming on
// hover or focus, the middle-click of a post link, and Back/Forward (popstate) walking the visitor's own steps.
import { $, $$, closest } from "../lib/dom";
import { createRemix, ownCreate, redrawComic, reviseRemix } from "./actions";
import { build, coarse, dashboard, dom, reduceMotion, root, slugs, starting, state, toTop } from "./context";
import { openDialog } from "./dialogs";
import { focusRequest, growInstruction, setInstruction, syncIdeas, syncPoint } from "./fields";
import { buildLink } from "./handoff";
import { forget, readIds, saveDraft, saveFast, saveThinking, syncUrl } from "./memory";
import { featuredBook, pressPoints } from "./page-data";
import { openLightbox } from "./pictures";
import { applyTextSize, loadChapters, openPreview, reader, setTab, showChapter, toggleToc, warmCovers } from "./reader";
import { divergenceChapter, focusHeading, resting, seen, showVersion, stepVersion } from "./screen";
import { copyLink, featuredUrl, openIntent, publishNow, shareFeatured, shareInstagram, shareNatively, shareParts, showShare } from "./share";
import { follow, followNow, syncFollow } from "./stream";
import { view } from "./view";
import { openShared, readFeatured, resetWorkspace, restore, resume, selectBook, warmShowcase } from "./workspace";

export function bindEvents(): void {
	const warm = (event: Event) => {
		const pick = closest(event.target, "[data-target-book]");
		if (pick) warmShowcase(pick.dataset.targetBook);
		const open = closest(event.target, "[data-open-preview], [data-read-original]");
		if (open) { warmCovers(open.dataset.openPreview ?? state.book); loadChapters(open.dataset.openPreview ?? state.book).catch(() => {}); }
	};
	document.addEventListener("pointerover", warm, { passive: true });
	document.addEventListener("focusin", warm);
	document.addEventListener("click", onClick);
	dom.composer.addEventListener("submit", (event) => {
		event.preventDefault();
		const request = dom.request.value.trim();
		if (!request) { dom.request.value = ""; dom.composer.reportValidity(); return; }
		if (!root.hasAttribute("data-busy")) createRemix(request);
	});
	// A turning point stays picked only while the box holds exactly its example: an emptied or edited box is the visitor's own what-if.
	// Fast mode and the thinking step: every copy (the composer's and the dock's capsule, a refused create's card) is the one remembered choice.
	root.addEventListener("change", (event) => {
		const input = event.target instanceof HTMLInputElement ? event.target : null;
		if (input?.matches("[data-fast]")) {
			for (const other of $$<HTMLInputElement>("[data-fast]", root)) other.checked = input.checked;
			saveFast(input.checked);
		} else if (input?.matches("[data-thinking]") && input.checked) {
			for (const other of $$<HTMLInputElement>(`[data-thinking][value="${input.value}"]`, root)) other.checked = true;
			saveThinking(input.value);
		}
	});
	dom.request.addEventListener("input", () => {
		syncPoint();
		saveDraft();
	});
	dom.request.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); dom.composer.requestSubmit(); } });
	dom.instruction.addEventListener("input", () => { growInstruction(); syncIdeas(); });
	// Enter sends (a phone's return key too); Shift + Enter makes a new line.
	dom.instruction.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		dom.steer.requestSubmit();
	});
	dom.steer.addEventListener("submit", (event) => {
		event.preventDefault();
		const instruction = dom.instruction.value.trim();
		if (!instruction) { setInstruction(""); dom.steer.reportValidity(); return; }
		if (!root.hasAttribute("data-busy")) reviseRemix(instruction);
	});
}

/** The rest of the bindings, after the reader's close (the dev order). */
export function bindNavigation(): void {
	// A post link opened with the middle button uploads the snapshot too.
	root.addEventListener("auxclick", (event) => { if (event.button === 1 && closest(event.target, "[data-share-link]") && shareParts()) publishNow(); });
	addEventListener("popstate", onPopState);
}

function onClick(event: MouseEvent): void {
	const target = event.target instanceof Element ? event.target : null;
	if (!target) return;
	const hook = (selector: string) => target.closest<HTMLElement>(selector);
	// Inert (aria-disabled) controls do nothing; a link's own default (Enter follows it) is cancelled too.
	if (target.closest('[aria-disabled="true"]')) { if (target.closest('a[aria-disabled="true"]')) event.preventDefault(); return; }
	const pick = hook("[data-target-book]");
	if (pick) return selectBook(pick.dataset.targetBook!);
	const open = hook("[data-open-preview]");
	if (open) { openPreview(open.dataset.openPreview!); return; }
	if (hook("[data-read-original]")) { openPreview(state.book, { chapterId: divergenceChapter() }); return; }
	if (hook("[data-read-featured]")) return readFeatured(hook("[data-read-featured]")!.dataset.readFeatured!, { push: true });
	if (hook("[data-follow-chip]")) {
		// A phone: the chip (CSS-shown while the live line is below it) brings the page to the chapter being written.
		if (!dashboard.matches) { dom.page?.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "instant" : "smooth" }); $("[data-result-chapter]", root)?.focus({ preventScroll: true }); return; }
		follow.on = true; follow.scrolled = false; followNow(); syncFollow(); return;
	}
	const opener = hook("[data-open-lightbox]");
	if (opener) return openLightbox(opener.dataset.openLightbox || "comic", opener);
	if (hook("[data-reader-retry]")) { openPreview(reader.slug!, { chapterId: reader.split }); return; }
	const chip = hook("[data-chip]");
	if (chip) {
		dom.request.value = chip.dataset.whatif!;
		root.setAttribute("data-picked", "");
		state.divergenceId = chip.dataset.divergence!;
		pressPoints(root, state.book, state.divergenceId);
		saveDraft();
		focusRequest();
		return;
	}
	const idea = hook("[data-idea]");
	if (idea) { setInstruction(idea.dataset.text!); if (!coarse.matches) dom.instruction.focus(); return; }
	if (hook("[data-version-prev]")) return stepVersion(-1);
	if (hook("[data-version-next]")) return stepVersion(1);
	if (hook("[data-version-latest]")) return showVersion(state.record?.versions.at(-1)?.n ?? null);
	if (hook("[data-new-remix]")) {
		const text = dom.request.value;
		const again = ownCreate();
		const point = state.lastPoint;
		// The visitor's own remix on screen with no create of this visit behind it (reopened by a reload or its link): its what-if.
		const own = !again && state.record && !state.record.featured && state.record.request ? state.record : null;
		forget(state.book);
		resetWorkspace();
		root.setAttribute("data-returned", ""); // compose arrives (CSS) rather than cutting in
		// The box and the turning point go together: your own what-if never carries the example's turning point.
		if (again) { dom.request.value = again; state.divergenceId = point; pressPoints(root, state.book, point); }
		else if (own) { dom.request.value = own.request; state.divergenceId = own.divergenceId ?? null; pressPoints(root, state.book, state.divergenceId); }
		else dom.request.value = text;
		syncPoint();
		saveDraft();
		syncUrl(true);
		focusRequest();
		return;
	}
	if (hook("[data-retry]")) {
		// A create that made no chapter (the writer failed, or the connection was lost): the same what-if is sent again.
		if (ownCreate()) { state.divergenceId = state.lastPoint; createRemix(state.lastRequest); }
		return;
	}
	if (hook("[data-comic-reload]")) { const current = seen(); if (current) view.images(root, current); return; }
	if (hook("[data-comic-retry]")) {
		// The chapter is fine: only the comic is drawn again.
		if (!state.record?.versions.length) return;
		redrawComic();
		return;
	}
	if (hook("[data-open-share]")) return showShare();
	if (hook("[data-open-build]")) { buildLink(); return openDialog(build); }
	if (hook("[data-cover-native]")) { shareNatively(); return; }
	const instagram = hook("[data-share-instagram]");
	if (instagram) { shareInstagram(instagram); return; }
	const featuredCopy = hook("[data-copy-featured]");
	if (featuredCopy) { const record = view.featured(featuredCopy.dataset.copyFeatured); if (record) copyLink(featuredCopy, featuredUrl(record)); return; }
	const featuredIntent = hook("[data-share-featured]");
	if (featuredIntent) { shareFeatured(featuredIntent as HTMLAnchorElement); return; } // the browser reads the href after this handler
	const intent = hook("[data-share-link]");
	if (intent) { openIntent(event, intent as HTMLAnchorElement); return; } // follows the href once the snapshot is stored; until then it opens the tab and waits
	const copy = hook("[data-copy-link]");
	if (copy) return copyLink(copy);
	const tab = hook("[data-tab-btn], [data-tab-go]");
	if (tab) return setTab((tab.dataset.tabBtn ?? tab.dataset.tabGo)!);
	if (hook("[data-toc-toggle]")) return toggleToc(reader.toc.hidden as boolean);
	const chapter = hook("[data-chapter]");
	if (chapter) { const index = reader.list.findIndex((item) => item.id === chapter.dataset.chapter); if (index >= 0) { showChapter(index); setTab("read"); } return; }
	if (hook("[data-prev]")) return showChapter(reader.index - 1);
	if (hook("[data-next]")) return showChapter(reader.index + 1);
	const size = hook("[data-size]");
	if (size) return applyTextSize(size.dataset.size === "up" ? 1 : -1);
}

// Back and Forward walk the visitor's own steps (create, book switch, example, New remix).
function onPopState(): void {
	for (const dialog of $$<HTMLDialogElement>("dialog[open]")) dialog.close();
	const params = new URLSearchParams(location.search);
	const id = params.get("id");
	const share = id ? null : params.get("share");
	if (share) {
		if (state.id === `share:${share}`) return;
		resetWorkspace();
		openShared(share);
		toTop();
		return;
	}
	let book = params.get("book");
	if (featuredBook(id)) book = featuredBook(id);
	else if (id) book = Object.entries(readIds()).find(([, saved]) => saved === id)?.[0] ?? book; // restore() corrects it from the saved remix
	if (!book || !slugs.includes(book)) book = state.book;
	if (id === (state.id ?? null) && book === state.book) return;
	if (book !== state.book) selectBook(book, { keep: true });
	resetWorkspace();
	// Focus lands where the visitor now is (the remix's heading, or the composer), unless they already put it somewhere.
	// The book's address before its create was accepted (it has no id yet) is that create's page.
	const pending = id ? null : starting.get(state.book);
	if (pending) { resume(pending); toTop(); return; }
	if (!id) { toTop(); if (resting() && !coarse.matches) dom.request.focus({ preventScroll: true }); return; }
	if (featuredBook(id)) readFeatured(id);
	else restore(id).then(() => { if (!resting()) return; if (root.dataset.phase === "idle") { if (!coarse.matches) dom.request.focus({ preventScroll: true }); } else focusHeading(); });
	toTop();
}
