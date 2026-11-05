// The renderer: one remix onto the studio's nodes. It only toggles attributes (the CSS does every motion), picks pre-rendered
// message variants, fills slots and clones templates. Phases, the masthead and its versions, the live prose, the decoded-only
// pictures, the tab title, and the compiled featured and fetched shared remixes in the stored shape.
import { $, $$, html } from "../lib/dom";
import { fillSlots, showMessage, showTitle } from "../lib/messages";
import { api, IMAGE_RETRIES } from "./constants";
import { blocks, markdown, smart, split, type BlockState } from "./markdown";
import { chapterRef, chipOf, coverOf, featuredTemplate, locale, type ChapterRef } from "./page-data";
import type { Chapter, Panel, Remix, RemixError, Status, Version, ViewRecord } from "./types";

/** The chapter as it streams (the live paragraph bookkeeping): whole paragraphs are appended once, the growing last one is redrawn. */
export interface StreamLive {
	key: string;
	text: string;
	split: ChapterRef;
	version: number;
	record: ViewRecord;
	reset?: boolean;
	done?: number;
	live?: ChildNode | null;
	state?: BlockState;
	words?: number;
}
export interface PhaseOptions { titleKey?: string; hint?: string | null; busy?: boolean; revision?: boolean; dock?: string; comicFailed?: boolean; revised?: boolean }
export type Phase = "idle" | "restoring" | Status;

/** rendered: the key of what the chapter pane shows ("stream:…" while streaming); opening: the chapter a create opens at. */
const state: { rendered: string; opening: ChapterRef | null; coverSrc: string | null; share: ((record: ViewRecord | null | undefined) => void) | null } = {
	rendered: "", opening: null, coverSrc: null, share: null,
};

const beatsOf = (panels: Panel[] | undefined): string[] => (panels ?? []).map((panel) => panel?.beat).filter((beat): beat is string => !!beat);

function phase(root: HTMLElement, name: Phase, { titleKey, hint = null, busy = false, revision = false, dock = "failed", comicFailed = false, revised = false }: PhaseOptions = {}): void {
	root.dataset.phase = name;
	html.removeAttribute("data-restore");
	if (busy) root.removeAttribute("data-quiet"); // what the visitor starts now arrives with its motion
	if (name !== "idle") root.removeAttribute("data-cut");
	root.toggleAttribute("data-busy", busy);
	root.toggleAttribute("data-revision", revision);
	root.toggleAttribute("data-comic-failed", comicFailed);
	if (titleKey) waitTitle(root, titleKey);
	showMessage($('[data-messages="progress-hint"]', root)!, hint);
	showMessage($('[data-messages="dock-failed"]', root)!, dock);
	showMessage($('[data-messages="comic-note"]', root)!, comicFailed ? "failed" : "missing");
	const kept = name === "error" && root.hasAttribute("data-has-result");
	for (const node of $$("[data-needs-result]", root)) node.setAttribute("aria-disabled", String(name !== "ready" && name !== "illustrating" && !kept));
	for (const node of $$("[data-needs-ready]", root)) node.setAttribute("aria-disabled", String(name !== "ready" && !kept));
	// A failure is announced as the one on screen.
	const status = name === "restoring" ? "restoring" : name === "writing" ? (revision ? "revising" : "writing") : name === "illustrating" ? "chapter" : name === "ready" ? (comicFailed ? "comicFailed" : revised ? "revised" : "ready") : name === "error" ? (titleKey && $(`[data-messages="status"] [data-message="${titleKey}"]`, root) ? titleKey : "failed") : null;
	showMessage($('[data-messages="status"]', root)!, status);
	tab(root, name, busy);
}

// The tab title (data-messages="tab-title"): "Writing…" while the studio works, "ready" when it finished while the visitor was in
// another tab (until they come back), else the page's own.
let tabTitle: string | null = null;
const setTabTitle = (group: HTMLElement | null, name: string | null): void => { if (group && name !== tabTitle) { tabTitle = name; showTitle(group, name); } };
function tab(root: HTMLElement, name: Phase, busy: boolean): void {
	const finished = tabTitle === "ready" || (tabTitle === "writing" && (name === "ready" || name === "illustrating"));
	setTabTitle($('[data-messages="tab-title"]', root), busy && name !== "restoring" ? "writing" : document.hidden && finished ? "ready" : null);
}
/** Coming back to the tab clears its "ready" title (bound on every page, as the dev bundle did at load). */
export const watchTabTitle = (): void => addEventListener("visibilitychange", () => { if (!document.hidden && tabTitle === "ready") setTabTitle($('[data-messages="tab-title"]'), null); });

const refText = (ref: ChapterRef | null | undefined): string => (ref && (ref.label || (ref.number ? String(ref.number) : ""))) || "";
const splitRef = (root: ParentNode, book: string | undefined, divergenceId: string | null | undefined): ChapterRef => chapterRef(book, chipOf(root, book, divergenceId)?.dataset.chapterId);
// The original chapter a remix replaces: the turning point it was asked from (a free-form what-if has none; the writer returns only
// { summary, chapter }, so a compiled example's own divergence is the only other source).
const replaced = (root: ParentNode, record: ViewRecord): ChapterRef => (record.chapter?.divergence?.chapterId ? chapterRef(record.book, record.chapter.divergence.chapterId) : splitRef(root, record.book, record.divergenceId));
function refFill(root: HTMLElement, ref: ChapterRef | null | undefined): void {
	fillSlots(root, { splitChapter: refText(ref), openChapter: refText(ref) });
	for (const word of $$("[data-ref-word]", root)) word.hidden = !!ref?.label;
}
function waitTitle(root: HTMLElement, key: string): void {
	const wait = key === "writing";
	const named = !!refText(state.opening);
	if (wait && named) refFill(root, state.opening);
	showMessage($('[data-messages="progress-title"]', root)!, wait ? (named ? "opening" : "finding") : key);
}
/** A writer provider that refused the request (error.provider, no showcase): its compiled variants' key (content
 * studio.unavailable, by provider id), or null when that provider has no copy of its own (the normal failure copy then). */
function unavailable(error: RemixError | null | undefined): string | null {
	const key = `unavailable-${error?.provider}`;
	return error?.provider && !error.showcase && $(`[data-messages="dock-failed"] [data-message="${key}"]`) ? key : null;
}
function phaseFor(record: ViewRecord, revising: boolean): [Phase, PhaseOptions] {
	if (record.status === "writing" || record.status === "illustrating") return [record.status, { titleKey: "writing", busy: true, revision: revising || (record.version ?? 0) > 1 }];
	if (record.status === "ready") return ["ready", { revised: !!revising }];
	const error = record.error || {};
	if (record.chapter && !error.revision && error.stage === "images") return ["ready", { comicFailed: true }];
	const refused = unavailable(error);
	return ["error", { titleKey: refused ?? "failed", hint: refused ?? "failed", dock: refused ?? (error.code === "no_more_versions" ? "no_more_versions" : "failed") }];
}

// The chapter as it streams: whole paragraphs are appended once, the growing last one is redrawn each frame. Returns whether this
// call opened the stream (a new key).
function stream(root: HTMLElement, s: StreamLive): boolean {
	const prose = $("[data-prose]", root)!;
	const opened = state.rendered !== s.key;
	if (opened || s.reset) {
		if (opened && !root.hasAttribute("data-has-result")) {
			showMessage($('[data-messages="status"]', root)!, "streaming");
			showMessage($('[data-messages="split"]', root)!, "at");
			refFill(root, s.split);
			root.toggleAttribute("data-split-pending", !refText(s.split));
			root.removeAttribute("data-no-split");
		}
		if (opened) {
			versionBar(root, s.record || { version: s.version });
			for (const step of $$<HTMLButtonElement>("[data-version-wrap] button", root)) step.disabled = true;
		}
		state.rendered = s.key;
		Object.assign(s, { done: 0, live: null, reset: false, state: { first: true }, words: -1 });
		prose.replaceChildren();
		root.setAttribute("data-has-result", "");
		root.setAttribute("data-streaming", "");
	}
	const list = split(s.text);
	const complete = list.length - 1;
	if (s.live) { s.live.remove(); s.live = null; }
	if (complete > s.done!) {
		const fragment = document.createDocumentFragment();
		blocks(fragment, list.slice(s.done, complete), s.state!);
		s.done = complete;
		prose.append(fragment);
	}
	const words = (s.text.match(/\S+/g) || []).length;
	if (words !== s.words) {
		s.words = words;
		showMessage($('[data-messages="live"]', root)!, "writing", { words: words.toLocaleString(locale()) });
	}
	const tail = list[complete]!;
	const live = document.createDocumentFragment();
	// An unclosed * in the growing paragraph is not shown as a stray mark.
	blocks(live, [(tail.match(/\*/g) || []).length % 2 ? tail.replace(/\*(?!.*\*)/, "") : tail], { first: s.state!.first });
	s.live = live.lastChild;
	prose.append(live);
	return opened;
}

// An image is revealed only once decoded (never half-drawn). A compiled example's picture that fails to load retries on IMAGE_RETRIES
// (a fresh `&retry=n` URL: setting the same src again does not refetch), then calls `failed`; a stored Blob (a blob: URL) has nothing
// to retry. Keyed on img.dataset.want, not on src.
const retries = new WeakMap<HTMLImageElement, ReturnType<typeof setTimeout>>();
function image(img: HTMLImageElement | null, wait: HTMLElement | null, url: string | null | undefined, owner: string | undefined, failed?: () => void): boolean {
	if (!img) return false;
	const blank = () => { img.hidden = true; img.removeAttribute("src"); img.removeAttribute("data-fresh"); if (wait) wait.hidden = false; };
	if (!url) { clearTimeout(retries.get(img)); img.dataset.want = ""; blank(); return false; }
	if (img.dataset.want === url) return true;
	clearTimeout(retries.get(img));
	img.dataset.want = url;
	if (img.dataset.owner !== String(owner)) blank();
	img.dataset.owner = String(owner);
	let tries = 0;
	const reveal = () => {
		if (img.dataset.want !== url) return;
		img.hidden = false;
		// The arrival animation restarts in CSS: each new picture flips data-fresh between a and b, whose animations have different names.
		img.setAttribute("data-fresh", img.dataset.fresh === "a" ? "b" : "a");
		if (wait) wait.hidden = true;
	};
	const load = (src: string) => {
		const next = new Image();
		next.onload = () => {
			const apply = () => {
				if (img.dataset.want !== url) return;
				img.src = src;
				if (typeof img.decode === "function") img.decode().then(reveal, reveal); else reveal();
			};
			if (typeof next.decode === "function") next.decode().then(apply, apply); else apply();
		};
		next.onerror = () => {
			if (img.dataset.want !== url) return;
			if (url.startsWith("blob:") || tries >= IMAGE_RETRIES.length) { img.dataset.want = ""; blank(); failed?.(); return; }
			retries.set(img, setTimeout(() => { if (img.dataset.want === url) load(`${url}${url.includes("?") ? "&" : "?"}retry=${++tries}`); }, IMAGE_RETRIES[tries]));
		};
		next.src = src;
	};
	load(url);
	return true;
}

/** Paints a validated chapter (once per distinct chapter), its versions and pictures; returns whether the chapter changed. */
function result(root: HTMLElement, record: ViewRecord): boolean {
	const chapter = record.chapter!;
	const text = chapter.chapter ?? "";
	let hash = 0;
	for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
	const key = `${record.id}:${record.version}:${chapter.title}:${text.length}:${hash}`;
	root.setAttribute("data-has-result", "");
	const changed = state.rendered !== key;
	if (changed) {
		state.rendered = key;
		root.removeAttribute("data-streaming");
		root.removeAttribute("data-split-pending");
		const ref = replaced(root, record);
		fillSlots(root, { request: smart(quote(record)), moment: chapter.divergence?.moment ?? "" });
		refFill(root, ref);
		showMessage($('[data-messages="split"]', root)!, refText(ref) ? "at" : "plain");
		root.toggleAttribute("data-no-split", !refText(ref) && !String(chapter.divergence?.moment ?? "").trim());
		markdown($("[data-prose]", root)!, text);
		const count = text.split(/\s+/).filter(Boolean).length;
		const minutes = String(Math.max(1, Math.round(count / 230)));
		showMessage($('[data-messages="live"]', root)!, "read", { minutes });
	}
	versionBar(root, record);
	images(root, record);
	return changed;
}
const quote = (record: ViewRecord): string => record.preview?.request ?? record.request ?? "";
const plain = (text: string | undefined): string => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** The change a version answers: what the free demo served instead of the typed one, else what was typed. */
const said = (entry: Version | null | undefined): string => entry?.preview?.instruction || entry?.instruction || "";

// The example / free-demo tag, and the notes that say when the demo served a different what-if or change than the one typed.
function tag(root: HTMLElement, record: ViewRecord): void {
	const node = $("[data-preview-tag]", root)!;
	const kind = record.shared ? "shared" : record.featured ? "example" : record.preview ? "demo" : null;
	node.hidden = !kind;
	if (kind) showMessage($('[data-messages="tag"]', node)!, kind);
	credit(root, record);
	const asked = (record.version ?? 0) > 1 ? record.asked ?? "" : "";
	const revised = !!record.preview?.instruction && !!asked && plain(asked) !== plain(record.preview.instruction);
	root.toggleAttribute("data-revise-note", revised);
	// A revision's "closest revision" note is said once, in the dock where it was typed; the pane keeps only the remix's own note
	// (the free demo served its own what-if), so the two never show the same thing at once.
	root.toggleAttribute("data-demo-note", !!record.preview && !!record.request && plain(record.request) !== plain(record.preview.request));
	showMessage($('[data-messages="demo-note"]', root)!, "create");
}
// The credit line names the Meta models that made the version on screen (Muse Wonder or Muse Spark, Muse Spark Open in Fast mode, and
// Muse Image): a compiled example records them, a live version keeps the models its accepted line reported (a share link opened
// elsewhere has none, so it shows no credit).
function credit(root: HTMLElement, record: ViewRecord): void {
	const parts: Record<string, boolean> = record.preview ? {} : {
		writerWonder: /^muse-wonder/.test(record.provenance?.writer?.model ?? ""),
		writer: /^muse-spark-(?!open)/.test(record.provenance?.writer?.model ?? ""),
		writerOpen: /^(meta-models\/)?muse-spark-open/.test(record.provenance?.writer?.model ?? ""),
		illustrator: /^muse-image/.test(record.provenance?.illustrator?.model ?? ""),
	};
	const line = $("[data-credit]", root)!;
	for (const node of $$("[data-credit-part]", line)) node.hidden = !parts[node.dataset.creditPart ?? ""];
	line.hidden = !parts.writerWonder && !parts.writer && !parts.writerOpen && !parts.illustrator;
}

// The change version v answers: the one on screen carries its own, the others are looked up in the remix's versions.
const instructionOf = (record: ViewRecord, v: number): string => (v < 2 ? "" : v === record.version ? record.instruction ?? "" : said((record.versions ?? []).find((item) => item.n === v)));
const labelled = (button: HTMLElement, instruction: string): void => { showMessage($("[data-messages]", button)!, instruction ? "with" : "plain", { instruction }); };
// record: { versions (the saved ones), version (on screen), latest, instruction (of the one on screen) }.
function versionBar(root: HTMLElement, record: ViewRecord): void {
	const wrap = $("[data-version-wrap]", root)!;
	const versions = record.versions ?? [];
	const version = record.version ?? 1;
	const latest = record.latest ?? version;
	const count = Math.max(latest, versions.length);
	wrap.hidden = count < 2 || (!!record.featured && versions.length < 2); // an example keeps one snapshot: nothing to step to
	wrap.toggleAttribute("data-history", count > 1);
	fillSlots(wrap, { version: String(version), versions: String(count) });
	$<HTMLButtonElement>("[data-version-prev]", wrap)!.disabled = !versions.some((item) => item.n < version);
	$<HTMLButtonElement>("[data-version-next]", wrap)!.disabled = version >= latest;
	const now = instructionOf(record, version);
	// Once a remix has versions, the Changed line keeps its row (blank on a version without a change), so stepping versions moves nothing.
	const changed = $("[data-changed-head]", root)!;
	changed.hidden = !now && count < 2;
	changed.toggleAttribute("data-blank", !now);
	fillSlots(changed, { changeText: now });
	labelled($("[data-version-prev]", wrap)!, instructionOf(record, version - 1));
	labelled($("[data-version-next]", wrap)!, instructionOf(record, version + 1));
}
function versionReset(root: HTMLElement): void {
	const wrap = $("[data-version-wrap]", root)!;
	wrap.hidden = true;
	wrap.removeAttribute("data-history");
	$("[data-changed-head]", root)!.hidden = true;
}

// The comic (its panel count and beats), the cover and its thumbnail, and their downloads.
function images(root: HTMLElement, record: ViewRecord): void {
	const chapter = record.chapter;
	const panels = chapter?.panels?.length ?? record.preview?.panels;
	root.dataset.panels = String(panels != null && panels >= 4 && panels <= 6 ? panels : 5);
	const beats = beatsOf(chapter?.panels);
	fillSlots(root, Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`beat${i + 1}`, smart(beats[i] ?? "")])));
	root.toggleAttribute("data-has-beats", beats.length > 0);
	const alt = $('[data-messages="comic-alt"]', root);
	if (alt) showMessage(alt, beats.length ? "beats" : "plain", { altCount: String(beats.length) });
	const unloaded = () => {
		root.removeAttribute("data-has-image");
		root.setAttribute("data-image-failed", "");
		showMessage($('[data-messages="comic-note"]', root)!, "unloaded");
	};
	root.removeAttribute("data-image-failed");
	const shown = image($<HTMLImageElement>("[data-comic]", root), $("[data-comic-wait]", root), record.images?.comic, record.id, unloaded);
	const coverUrl = record.images?.cover ?? record.images?.share;
	image($<HTMLImageElement>("[data-cover]", root), null, coverUrl, record.id);
	image($<HTMLImageElement>("[data-cover-thumb]", root), null, coverUrl, record.id);
	root.toggleAttribute("data-has-image", shown);
	const download = $<HTMLAnchorElement>("[data-comic-download]", root);
	if (download && record.images?.comic) download.href = record.images.comic;
	cover(root, record);
}
// The cover's download and share actions follow the picture actually on screen (never a previous record's).
function cover(root: HTMLElement, record: ViewRecord | null | undefined): void {
	const img = $<HTMLImageElement>("[data-cover]", root);
	const src = img?.getAttribute("src");
	state.coverSrc = src && img!.dataset.want && src.startsWith(img!.dataset.want) ? src : null;
	for (const link of $$<HTMLAnchorElement>("[data-cover-download]", root)) {
		if (state.coverSrc && !root.hasAttribute("data-viewing-old")) { link.href = state.coverSrc; link.removeAttribute("aria-disabled"); }
		else { link.href = coverOf(record?.book ?? document.documentElement.dataset.book); link.removeAttribute("aria-disabled"); } // no cover of this remix (yet): the original's
	}
	state.share?.(record);
}
// Right after a create is accepted: the free demo's what-if and comic size are known before the chapter.
function early(root: HTMLElement, book: string, created: { preview?: ViewRecord["preview"]; divergenceId?: string } | null | undefined, request: string): void {
	const preview = created?.preview;
	state.opening = splitRef(root, book, created?.divergenceId);
	if (root.dataset.phase === "writing" && !root.hasAttribute("data-has-result")) waitTitle(root, "writing");
	if (!preview) return images(root, { images: {} });
	const headline = $('[data-classlist~="remix-heading-request"]', root);
	const was = headline?.textContent;
	fillSlots(root, { request: smart(quote({ preview, request })) });
	// The free demo answers its own what-if: the headline fades to it (CSS on data-retitled) rather than swapping its words in one frame.
	if (headline && headline.textContent !== was) root.setAttribute("data-retitled", "");
	tag(root, { preview, request });
	images(root, { preview, images: {} });
}
/** Paints a record and its phase; returns the phase. */
function apply(root: HTMLElement, record: ViewRecord, revising: boolean): Phase {
	root.removeAttribute("data-error");
	fillSlots(root, { request: smart(quote(record)) });
	tag(root, record);
	state.opening = splitRef(root, record.book, record.divergenceId);
	if (record.chapter && (record.status !== "writing" || !state.rendered)) result(root, record);
	else images(root, record);
	const [name, options] = phaseFor(record, revising);
	phase(root, name, options);
	return name;
}

// A featured remix, read from its compiled template (data-f-* attributes; the chapter is the template's text), in the shape of a
// stored remix with plain URLs for its pictures.
function featured(id: string | null | undefined): Remix | null {
	const t = featuredTemplate(id);
	if (!t) return null;
	const d = t.dataset;
	const chapter: Chapter = {
		panels: (JSON.parse(d.fPanels || "[]") as string[]).map((beat) => ({ beat })), continuity: JSON.parse(d.fContinuity || "[]"), title: d.fTitle, logline: d.fLogline,
		divergence: { chapterId: d.fChapterId, moment: d.fMoment, change: d.fChange }, castInScene: d.fCast ? d.fCast.split(" ") : [], shareText: d.fShareText, chapter: t.content.textContent ?? "",
	};
	return {
		id: d.fId!, book: d.fBook!, request: d.fRequest!, divergenceId: d.fPoint || null, featured: true,
		cover: d.fCover || null,
		provenance: { writer: { model: d.fWriter }, illustrator: { model: d.fIllustrator } },
		versions: [{ n: Number(d.fVersion) || 1, comic: d.fComic || null, chapter }],
	};
}
/** A shared remix (GET /api/share/<id>) as the API returns it. */
export interface SharedData { id: string; book: string; request: string; divergenceId?: string | null; chapter: Chapter; pictures?: { cover?: { hash?: string }; comic?: { hash?: string } } }
// A shared remix in the same read-only shape, its pictures on the API.
const sharedRecord = (data: SharedData): Remix => ({
	id: `share:${data.id}`, shareId: data.id, book: data.book, request: data.request, divergenceId: data.divergenceId ?? null, featured: true, shared: true,
	cover: data.pictures?.cover?.hash ? `${api}/api/share-picture/${data.pictures.cover.hash}` : null,
	versions: [{ n: 1, comic: data.pictures?.comic?.hash ? `${api}/api/share-picture/${data.pictures.comic.hash}` : null, chapter: data.chapter }],
});

/** The renderer and what it last painted (rendered, opening, coverSrc), plus the share hook (share.ts sets it). */
export const view = Object.assign(state, {
	phase, phaseFor, unavailable, apply, result, stream, image, images, cover, early, tag, versionBar, versionReset,
	refText, splitRef, replaced, refFill, waitTitle, quote, said, smart, markdown, featured, sharedRecord,
});
