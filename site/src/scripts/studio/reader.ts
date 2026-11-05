// The reader (dialog[data-modal="preview"]): a book's About and its original chapters, read from /library/<slug>/chapters.json (0.2-0.5 MB
// a book, so never compiled in: one shared request per book, warmed on hover or focus of a Preview control), its contents list, the
// split marker of the remix on screen, and the text size (data-text-size 0..4, remembered as remix:text-size; the sizes are CSS).
import { $, $$ } from "../lib/dom";
import { fillSlots, showMessage } from "../lib/messages";
import { safeLocalStorage as local } from "../lib/storage";
import { SIZE_KEY, TEXT_SIZES } from "./constants";
import { preview, root } from "./context";
import { openDialog } from "./dialogs";
import { chapterRef } from "./page-data";
import { seen } from "./screen";
import { view } from "./view";

interface BookChapter { id: string; kind?: string; title?: string; text: string }

const chapters = new Map<string, Promise<BookChapter[]>>();
async function getJson<T>(path: string): Promise<T> {
	const response = await fetch(path);
	if (!response.ok) throw new Error(`status ${response.status}`);
	return response.json() as Promise<T>;
}
export const loadChapters = (slug: string): Promise<BookChapter[]> => {
	if (!chapters.has(slug)) chapters.set(slug, getJson<{ chapters: BookChapter[] }>(`/library/${encodeURIComponent(slug)}/chapters.json`).then((data) => data.chapters, (error) => { chapters.delete(slug); throw error; }));
	return chapters.get(slug)!;
};

export const reader: { slug: string | null; split?: string | null; list: BookChapter[]; index: number; body: HTMLElement; text: HTMLElement; status: HTMLElement; toc: HTMLElement } = {
	slug: null, list: [], index: 0, body: null!, text: null!, status: null!, toc: null!,
};
/** The reader's nodes (once, at start). */
export function initReader(): void {
	Object.assign(reader, { body: $("[data-reader-body]", preview), text: $("[data-reader-text]", preview), status: $('[data-messages="reader-status"]', preview), toc: $("[data-toc]", preview) });
}

export function setTab(tab: string): void {
	preview.dataset.tab = tab;
	for (const button of $$("[data-tab-btn]", preview)) button.setAttribute("aria-pressed", String(button.dataset.tabBtn === tab));
}
export function toggleToc(open: boolean): void {
	reader.toc.hidden = !open;
	for (const button of $$("[data-toc-toggle]", preview)) button.setAttribute("aria-expanded", String(open));
}
export function applyTextSize(step: number): void {
	const stored = Number(local.getItem(SIZE_KEY) ?? 2);
	const index = Math.min(Math.max((Number.isFinite(stored) ? stored : 2) + step, 0), TEXT_SIZES - 1);
	local.setItem(SIZE_KEY, String(index));
	reader.text.dataset.textSize = String(index);
	// Zoom in and out are disabled at their ends (as Previous and Next are); a focused one at its end hands focus to the other.
	for (const button of $$<HTMLButtonElement>("[data-size]", preview)) {
		const end = button.dataset.size === "up" ? index === TEXT_SIZES - 1 : index === 0;
		if (end && document.activeElement === button) $(`[data-size="${button.dataset.size === "up" ? "down" : "up"}"]`, preview)?.focus();
		button.disabled = end;
	}
}
// The reader's covers are lazy (ten hidden variants must not download), and a lazy image in a dialog that has just opened paints a
// beat late: a blank cover. Warming a book (hover, focus, open) makes only that book's covers eager.
export function warmCovers(slug: string): void {
	for (const img of $$<HTMLImageElement>(`[data-preview-variant="${slug}"] img[loading="lazy"]`, preview)) img.loading = "eager";
}
export async function openPreview(slug: string, { chapterId = null }: { chapterId?: string | null } = {}): Promise<void> {
	reader.slug = slug;
	reader.split = chapterId;
	warmCovers(slug);
	for (const node of $$("[data-preview-variant]", preview)) node.hidden = node.dataset.previewVariant !== slug;
	for (const node of $$("[data-toc-book]", preview)) node.hidden = node.dataset.tocBook !== slug;
	setTab("about");
	toggleToc(false);
	reader.text.replaceChildren();
	reader.list = []; // never the previous book's chapters under this one's name, while it loads or if it fails
	// Opened at the remix's own split chapter: the marker also shows the moment it splits at (the studio shows only the chapter).
	const divergence = root.hasAttribute("data-has-result") ? seen()?.chapter?.divergence : null;
	fillSlots(preview, { splitMoment: chapterId && divergence?.chapterId === chapterId ? divergence.moment ?? "" : "" });
	showMessage(reader.status, "loading");
	openDialog(preview);
	try {
		const list = await loadChapters(slug);
		if (reader.slug !== slug) return;
		reader.list = list;
		showMessage(reader.status, null);
		const split = chapterId ? reader.list.findIndex((chapter) => chapter.id === chapterId) : -1;
		const first = reader.list.findIndex((chapter) => chapter.kind === "chapter");
		showChapter(split >= 0 ? split : first >= 0 ? first : 0, { scroll: false });
		if (split >= 0) setTab("read");
	} catch { if (reader.slug === slug) showMessage(reader.status, "failed"); }
}
export function showChapter(index: number, { scroll = true }: { scroll?: boolean } = {}): void {
	const chapter = reader.list[index];
	if (!chapter) return;
	reader.index = index;
	view.markdown(reader.text, chapter.text, chapterRef(reader.slug!, chapter.id).label || chapter.title); // the original's own label ("Chapter V"), as the studio names it
	const marker = $("[data-split-marker]", preview);
	if (marker) marker.hidden = !reader.split || reader.split !== chapter.id;
	$<HTMLButtonElement>("[data-prev]", preview)!.disabled = index === 0;
	$<HTMLButtonElement>("[data-next]", preview)!.disabled = index === reader.list.length - 1;
	for (const item of $$(`[data-toc-book="${reader.slug}"] [data-chapter]`, preview)) item.setAttribute("aria-current", String(item.dataset.chapter === chapter.id));
	if (scroll) reader.body.scrollTo({ top: 0, behavior: "instant" });
	const picked = reader.toc.contains(document.activeElement); // a chapter chosen from Contents: focus moves on to its text
	toggleToc(false);
	if (picked) reader.body.focus({ preventScroll: true });
}

/** Closing the reader closes Contents; Escape with Contents open closes Contents only (the reader stays; focus returns to the button
 * that opened it). */
export function bindReader(): void {
	preview.addEventListener("close", () => toggleToc(false));
	preview.addEventListener("cancel", (event) => {
		if (reader.toc.hidden) return;
		event.preventDefault();
		toggleToc(false);
		$("[data-toc-toggle][aria-controls]", preview)?.focus();
	});
}
