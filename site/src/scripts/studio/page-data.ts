// Page data compiled into the markup (never script tables): chapter labels and numbers from the reader's contents buttons, the
// featured remixes' templates, each book's example on its compose heading, and the turning-point chips.
import { $, $$, esc, html } from "../lib/dom";

export interface ChapterRef { label: string; number: number | null }

/** A chapter's label ("Chapter V") and printed number, from the reader's contents list (data-chapter-label, data-chapter-number). */
export function chapterRef(book: string | undefined, chapterId: string | null | undefined): ChapterRef {
	const node = chapterId ? $(`[data-toc-book="${esc(book)}"] [data-chapter="${esc(chapterId)}"]`) : null;
	const number = node?.dataset.chapterNumber ? Number(node.dataset.chapterNumber) : null;
	return { label: node?.dataset.chapterLabel ?? "", number: Number.isFinite(number) ? number : null };
}

/** The original cover's file of a book (the prepared picture's fallback, compiled on its build-dialog facts as data-cover-src). */
export const coverOf = (book: string | undefined): string => $(`[data-book-facts="${esc(book)}"]`)?.dataset.coverSrc ?? "";

export const featuredTemplate = (id: string | null | undefined): HTMLTemplateElement | null =>
	$$<HTMLTemplateElement>("template[data-featured-record]").find((template) => template.dataset.fId === id) ?? null;
export const featuredBook = (id: string | null | undefined): string | null => (id && featuredTemplate(id)?.dataset.fBook) || null;

/** The book's example (compiled on its compose heading): a real value, so Write works at once, with its turning point. */
export function exampleOf(book: string): { text: string; divergence: string | null } {
	const panel = $(`[data-example][data-book-panel="${esc(book)}"]`);
	return { text: panel?.dataset.example ?? "", divergence: panel?.dataset.examplePoint || null };
}

/** The turning-point chips of the book: the picked one is pressed. */
export function pressPoints(root: ParentNode, book: string, divergence: string | null): void {
	for (const chip of $$('[data-classlist~="remix-points-book"] [data-chip]', root)) {
		chip.setAttribute("aria-pressed", String(!!divergence && chip.dataset.divergence === divergence && chip.closest<HTMLElement>("[data-book-panel]")!.dataset.bookPanel === book));
	}
}
export const chipOf = (root: ParentNode, book: string | undefined, divergenceId: string | null | undefined): HTMLElement | null =>
	divergenceId ? $(`[data-classlist~="remix-points-book"][data-book-panel="${esc(book)}"] [data-chip][data-divergence="${esc(divergenceId)}"]`, root) : null;

/** Numbers are written in the page's language. */
export const locale = (): string | undefined => html.lang || undefined;
