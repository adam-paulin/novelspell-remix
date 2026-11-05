// The NovelSpell hand-off (the build dialog's link): the parameters, the brief's shape and its
// budget (BRIEF_CAP) are NovelSpell's. NovelSpell's /custom validates every value against its own form and ignores what it does not
// know; nothing is ordered. The prefill rides in the fragment, which no browser sends in a request or a Referer; only the
// attribution tags are a query.
import { $ } from "../lib/dom";
import { fillSlots } from "../lib/messages";
import { BRIEF_CAP } from "./constants";
import { build, root, state } from "./context";
import { seen } from "./screen";
import { presetOf, validated } from "./share";
import { view } from "./view";

export function buildLink(): void {
	const record = seen();
	const chapter = validated(record) ? record!.chapter ?? record!.versions!.at(-1)!.chapter : null;
	const facts = $(`[data-book-facts="${state.book}"]`, build);
	const lookup = (kind: string, id: string | undefined) => $(`[data-lookup="${kind}"] [data-id="${id}"]`, build)?.textContent ?? id;
	const book = facts?.dataset ?? {};
	const d = build.dataset;
	const fill = (id: string, values: Record<string, string | undefined>) => (lookup("brief", id) ?? "").replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
	// One brief string: the book, the original chapter this one replaces (a free-form what-if names none, so
	// it says what was asked instead), then the full new chapter as written. Before the chapter is validated (the book's preset): the
	// book and the what-if, without a chapter.
	const replaced = view.refText(chapter ? view.replaced(root, record!) : view.splitRef(root, state.book, state.divergenceId));
	const request = view.quote(record && view.quote(record) ? record : presetOf());
	const brief = (chapter ? [
		fill("basedOn", { book: book.title, author: book.author }),
		replaced ? fill("replaces", { chapter: replaced }) : fill("replacesNone", { request }),
		fill("chapter", {}),
		String(chapter.chapter ?? "").trim(),
	] : [
		fill("presetBasedOn", { book: book.title, author: book.author }),
		request ? (replaced ? fill("presetWhatIf", { chapter: replaced, request }) : fill("presetWhatIfNone", { request })) : "",
	]).filter(Boolean).join("\n\n");
	const params = new URLSearchParams({ language: d.language!, genre: book.nsGenre ?? "", arc: book.nsArc ?? "", source: state.book, brief: brief.slice(0, BRIEF_CAP), ...(chapter ? { remix: record!.id! } : {}) });
	const tags = new URLSearchParams({ utm_source: "novelspell-remix", utm_medium: "remix" });
	$<HTMLAnchorElement>("[data-build-link]", build)!.href = `${d.origin}${d.path}?${tags}#${params}`;
	fillSlots(build, { genre: lookup("genre", facts?.dataset.nsGenre), arc: lookup("arc", facts?.dataset.nsArc) });
	// The cover art is this remix's cover (the same URL the card loads, so it comes from cache): the plate stays until the picture is
	// decoded. The preset: the original's cover.
	if (record?.images?.cover) view.image($<HTMLImageElement>("[data-build-img]", build), null, record.images.cover, record.id);
	else { const img = $<HTMLImageElement>("[data-build-img]", build); if (img) { img.src = facts?.dataset.coverSrc ?? ""; img.hidden = false; } }
}
