// Sharing. The cover card (above the comic on desktop, the masthead row on phones) carries Share… (a touch device's share sheet),
// Copy link, the post intents (Facebook, WhatsApp, Threads) and Instagram; the showcase's example shares itself.
//
// Shared links (backend shares.js): a remix lives only in its maker's browser, so a share link is a published snapshot of one version
// (the one on screen): its signed token, plus the cover and its comic once they carry the signature the Worker put on their image
// events (a picture without one stays home). The id is a hash of the token (the Worker computes the same), so the link is known at
// once, and a link posted before the comic landed gains it: each signed picture that arrives for a version already shared is sent to
// its link. Copy link copies the link once its snapshot is stored; a post (Facebook, WhatsApp, Threads) opens its tab inside the tap and
// loads the post once the snapshot is stored (openIntent: leaving the page first would cancel the upload and post a dead link); a share
// sheet opens at once (a tap's permission does not outlast an upload), the upload finishing behind it while the visitor picks an app;
// a failed upload is said (the toast) and tried again when the visitor comes back.
import { $, $$ } from "../lib/dom";
import { showMessage } from "../lib/messages";
import { api, NOTICE_MS } from "./constants";
import { build, dashboard, dom, live, root, state, toTop } from "./context";
import { extensionOf, saveImage } from "./pictures";
import { loadRemix, pictureAt, saveRemix } from "./records";
import { seen } from "./screen";
import type { Remix, SharedMark, Version, ViewRecord } from "./types";
import { view } from "./view";

// ---------- what the card shares ----------
// The caption: the chapter's share text plus the hashtag (words come from content: data-hashtag on the card). Before a remix has a
// validated chapter the card shares its preset: the book page and the what-if typed for it.
export const presetOf = (): ViewRecord => ({ book: state.book, request: (seen()?.request ?? dom.request.value ?? "").trim() });
export const validated = (record: ViewRecord | null = seen()): boolean => !!(record?.chapter ?? record?.versions?.at(-1)?.chapter);
// What the card shares when it is not the visitor's own remix: an example or a shared remix opens by the page's own link (?id= of a
// compiled example, ?share=); before a chapter, the book page. The visitor's own remix shares its share link (shareTarget below).
const shareUrl = (): string => {
	const record = state.record;
	if (validated() && record?.shared) return shareLink(record.book, record.shareId!);
	if (validated() && record?.featured) return featuredUrl(record);
	const url = new URL(location.pathname, location.href);
	url.searchParams.set("book", state.book);
	return url.href;
};
const caption = (record: ViewRecord | null | undefined = seen()): string => {
	const subject = record && view.quote(record) ? record : presetOf();
	const text = view.quote(subject) ? labelOf($("[data-cover-card]", root)?.dataset.shareText, subject) : "";
	const tag = $("[data-cover-card]", root)?.dataset.hashtag ?? "";
	return text && tag && !text.includes(tag) ? `${text} ${tag}` : text;
};
// A remix has no title of its own beyond the one painted on its cover: where a label is needed it is the book
// plus the reader's what-if, through a content template with {book} and {request} holes.
export const labelOf = (template: string | undefined, record: ViewRecord | null | undefined): string => {
	const book = $(`[data-book-facts="${record?.book ?? state.book}"]`, build)?.dataset.title ?? "";
	return (template ?? "").replace(/\{(\w+)\}/g, (_, key: string) => ({ book, request: view.quote(record ?? {}) } as Record<string, string>)[key] ?? "");
};
const shareNative = (): boolean => !!(typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches);

// ---------- shared links ----------
const shareLink = (book: string, id: string): string => { const url = new URL(location.pathname, location.href); url.searchParams.set("book", book); url.searchParams.set("share", id); return url.href; };
export interface ShareParts { record: Remix; entry: Version; cover: Blob | null; coverSig: string; comic: Blob | null; comicSig: string }
export function shareParts(record: Remix | null = state.record, entry: Version | undefined = record?.versions?.find((item) => item.n === state.viewing) ?? record?.versions?.at(-1)): ShareParts | null {
	if (!entry?.token || record!.featured) return null;
	const remix = record!;
	const cover = remix.cover instanceof Blob && remix.coverSig ? remix.cover : null;
	const comic = entry.comic instanceof Blob && entry.comicSig ? entry.comic : null;
	return { record: remix, entry, cover, coverSig: cover ? remix.coverSig! : "", comic, comicSig: comic ? entry.comicSig! : "" };
}
const shareIds = new Map<string, Promise<string>>(); // token -> Promise<id>
const shareIdsNow = new Map<string, string>(); // token -> id, once known (a share sheet must open inside the tap: no await)
function shareIdOf(parts: ShareParts): Promise<string> {
	const token = parts.entry.token!;
	if (!shareIds.has(token)) shareIds.set(token, crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)).then((digest) => {
		const id = btoa(String.fromCharCode(...new Uint8Array(digest).subarray(0, 16))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
		shareIdsNow.set(token, id);
		return id;
	}));
	return shareIds.get(token)!;
}
// What the Worker already holds for a version's link: entry.shared = { api, id, cover, comic } (the picture signatures sent), kept
// with the remix, so a reload never uploads again (and a different API, e.g. local vs deployed, starts over).
const held = (parts: ShareParts, id: string): SharedMark | null => (parts.entry.shared?.api === api && parts.entry.shared.id === id ? parts.entry.shared : null);
const uploads = new Map<string, Promise<string>>(); // "id|coverSig|comicSig" -> Promise<id>
function publish(parts: ShareParts, id: string): Promise<string> {
	const before = held(parts, id);
	const send = (["cover", "comic"] as const).filter((slot) => parts[slot] && before?.[slot] !== parts[`${slot}Sig`]);
	if (before && !send.length) return Promise.resolve(id);
	const key = `${id}|${parts.coverSig}|${parts.comicSig}`;
	if (!uploads.has(key)) uploads.set(key, (async () => {
		const form = new FormData();
		form.set("token", parts.entry.token!);
		for (const slot of send) { form.set(slot, parts[slot]!, slot); form.set(`${slot}Sig`, parts[`${slot}Sig`]); }
		for (const wait of [0, 1500, 4000]) {
			if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
			try {
				const response = await fetch(`${api}/api/share`, { method: "POST", body: form });
				if (response.ok) {
					const made = ((await response.json()) as { id?: string } | null)?.id || id;
					const shared: SharedMark = { api, id: made, cover: before?.cover ?? null, comic: before?.comic ?? null };
					for (const slot of send) shared[slot] = parts[`${slot}Sig`];
					markShared(parts.record.id, parts.entry.token!, shared);
					return made;
				}
				if (response.status < 500) break; // refused: trying again changes nothing
			} catch { /* offline for a moment: try again */ }
		}
		uploads.delete(key);
		throw new Error("share upload failed");
	})());
	return uploads.get(key)!;
}
// The mark goes on every copy of the version in memory and on the stored copy (read fresh: never an older whole object over a newer one).
async function markShared(recordId: string, token: string, shared: SharedMark): Promise<void> {
	for (const record of new Set([state.record, ...[...live.values()].map((run) => run.record)])) {
		if (record?.id === recordId) for (const entry of record.versions) if (entry.token === token) entry.shared = shared;
	}
	const stored = await loadRemix(recordId);
	const entry = stored?.versions?.find((item) => item.token === token);
	if (entry) { entry.shared = shared; saveRemix(stored!); }
}
// Whether the Worker already holds this version's snapshot with every signed picture it has now (nothing left to send).
function stored(parts: ShareParts): boolean {
	const id = shareIdsNow.get(parts.entry.token!);
	const before = id ? held(parts, id) : null;
	return !!before && (["cover", "comic"] as const).every((slot) => !parts[slot] || before[slot] === parts[`${slot}Sig`]);
}
/** A post intent of the visitor's own remix (a tap on Facebook, WhatsApp or Threads). Once its snapshot is stored the browser just follows
 *  the link (false). Before that the tap opens a blank tab itself (inside the tap: no popup blocker), the studio stays as it is while the
 *  snapshot uploads, and the tab then loads the post with the stored link; on a failed upload the tab closes and the toast says so. */
export function openIntent(event: Event, link: HTMLAnchorElement): boolean {
	const parts = shareParts();
	const kind = link.dataset.shareLink ?? "";
	if (!parts || stored(parts)) { if (parts) publishNow(parts); return false; }
	event.preventDefault();
	const tab = window.open("about:blank", "_blank");
	if (tab) tab.opener = null;
	const tagged = caption();
	publishNow(parts).link.then((url) => {
		const href = intents(tagged, url)[kind];
		if (!href) { tab?.close(); return; }
		if (tab && !tab.closed) tab.location.href = href; else location.href = href;
	}, () => tab?.close());
	return true;
}
interface ShareTarget { url: Promise<string>; uploaded: Promise<unknown>; link: Promise<string> }
// The link of what the card shares now: url (known at once), uploaded (the snapshot stored) and link (the stored link, for the clipboard).
function shareTarget(parts: ShareParts | null = shareParts()): ShareTarget {
	if (!parts) { const url = Promise.resolve(shareUrl()); return { url, uploaded: Promise.resolve(), link: url }; }
	const id = shareIdOf(parts);
	const uploaded = id.then((value) => publish(parts, value));
	return { url: id.then((value) => shareLink(parts.record.book, value)), uploaded, link: uploaded.then((made) => shareLink(parts.record.book, made)) };
}
let sayTimer: ReturnType<typeof setTimeout> | undefined;
function say(name: string): void {
	const notice = $("[data-hosting-toast]");
	if (!notice) return;
	showMessage(notice, name);
	notice.setAttribute("data-on", "");
	clearTimeout(sayTimer);
	sayTimer = setTimeout(() => notice.removeAttribute("data-on"), NOTICE_MS);
}
/** A share action's upload: its failure is said, and the same version is sent again when the visitor next comes back to the page. */
export function publishNow(parts: ShareParts | null = shareParts()): ShareTarget {
	const target = shareTarget(parts);
	if (parts) target.uploaded.catch((error: unknown) => {
		console.error("[share]", error);
		say("shareFailed");
		const again = () => {
			if (document.hidden) return;
			removeEventListener("focus", again);
			document.removeEventListener("visibilitychange", again);
			publishNow(parts);
		};
		addEventListener("focus", again);
		document.addEventListener("visibilitychange", again);
	});
	return target;
}

// ---------- the card's links and buttons ----------
const intents = (tagged: string, url: string): Record<string, string> => {
	const both = [tagged, url].filter(Boolean).join("\n");
	return {
		facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
		whatsapp: `https://wa.me/?text=${encodeURIComponent(both)}`,
		threads: `https://www.threads.com/intent/post?text=${encodeURIComponent(both)}`,
	};
};
// Instagram has no web share address: a phone's share sheet carries the cover itself (Instagram is in it); elsewhere the cover is
// saved, the caption and link are copied for the post, and Instagram opens in a new tab.
export function shareInstagram(button: HTMLElement): void {
	const record = button.dataset.featuredId ? view.featured(button.dataset.featuredId) : null;
	if (!record && shareNative()) { shareNatively(); return; }
	// The clipboard first, while the tap's permission holds (opening the tab uses it up).
	const link = record ? Promise.resolve(featuredUrl(record)) : publishNow().link;
	const tagged = caption(record ?? undefined);
	writeClipboard(link.then((url) => `${tagged}\n${url}`.trim())).catch(() => {});
	window.open("https://www.instagram.com/", "_blank", "noopener");
	const card = button.closest("[data-cover-card]")!;
	const save = $("[data-download-image]", card);
	if (save) saveImage(save);
}
// Called by view.cover whenever a record is painted or the cover changes: the intent links need the validated chapter's caption
// (without it they carry no href, so they are neither focusable nor followable), Share… shows on a touch device with a share sheet.
let shareSeq = 0;
function paintShare(record: ViewRecord | null | undefined): void {
	const tagged = caption(record);
	const seq = ++shareSeq;
	const apply = (url: string) => {
		if (seq !== shareSeq) return;
		const hrefs = intents(tagged, url);
		for (const link of $$<HTMLAnchorElement>("[data-share-link]", root)) { const href = hrefs[link.dataset.shareLink ?? ""]; if (href) link.href = href; else link.removeAttribute("href"); }
	};
	const parts = shareParts();
	if (parts) shareIdOf(parts).then((id) => apply(shareLink(parts.record.book, id))); else apply(shareUrl());
	const native = shareNative();
	for (const button of $$("[data-cover-native]", root)) button.hidden = !native;
	// The share sheet has its own Copy, so on such a device it takes copy link's place and the row keeps its size.
	for (const button of $$("[data-copy-link]", root)) button.hidden = native;
	prepareShareFile(native ? view.coverSrc : null);
}
// The cover as a File, fetched ahead of the tap (a share sheet must start inside the tap's user activation): the picture goes with
// the post where the device can share files. Null when it cannot, and the caption and link go alone.
let shareFile: File | null = null;
let shareFileSrc: string | null = null;
let shareFileAsked: string | null = null;
async function prepareShareFile(src: string | null): Promise<void> {
	if (src === shareFileAsked) return;
	shareFileAsked = src;
	shareFile = null;
	shareFileSrc = null;
	if (!src || typeof navigator.canShare !== "function") return;
	try {
		const blob = await pictureAt(src);
		const file = new File([blob], `${$("[data-cover-download]", root)?.getAttribute("download") ?? ""}.${extensionOf(blob)}`, { type: blob.type || "image/jpeg" });
		if (navigator.canShare({ files: [file] }) && view.coverSrc === src) { shareFile = file; shareFileSrc = src; }
	} catch { /* the share goes without the picture */ }
}
export async function shareNatively(): Promise<void> {
	const title = labelOf($("[data-cover-card]", root)?.dataset.redditTitle, seen() ?? state.record);
	const text = caption();
	const parts = shareParts();
	const known = parts && shareIdsNow.get(parts.entry.token!);
	if (parts) publishNow(parts); // the upload goes on behind the share sheet
	const url = !parts ? shareUrl() : known ? shareLink(parts.record.book, known) : await publishNow(parts).url; // (known once the card painted)
	// Only the picture on screen goes: a file prepared for one that has since been replaced stays home.
	const file = shareFile && shareFileSrc === view.coverSrc ? shareFile : null;
	try {
		if (file) await navigator.share({ title, text: `${text}\n${url}`, files: [file] });
		else await navigator.share({ title, text, url });
	} catch (error) {
		if ((error as Error | null)?.name === "AbortError") return;
		if (file) { try { await navigator.share({ title, text, url }); return; } catch (again) { if ((again as Error | null)?.name === "AbortError") return; } }
		// No share sheet after all (the tap's permission ran out, or the sheet refused): the link goes to the clipboard instead.
		writeClipboard(url).then(() => say("linkCopied"), () => {});
	}
}
// The clipboard takes a text that may still be coming (ClipboardItem with a promise keeps the tap's permission where awaiting would lose it).
function writeClipboard(text: string | Promise<string>): Promise<void> {
	if (typeof text === "string") return navigator.clipboard.writeText(text.trim());
	if (typeof ClipboardItem === "function" && navigator.clipboard.write) return navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((value) => new Blob([value.trim()], { type: "text/plain" })) })]);
	return text.then((value) => navigator.clipboard.writeText(value.trim()));
}
// Copy link: the link alone (the post's words are the visitor's). The visitor's own remix: "Link copied" once its snapshot is
// uploaded, so the copied link already opens anywhere; until then the button shows it is saving (data-saving, aria-busy); then it
// says it (or the failure) for a moment, with the toast, and goes back.
const copyTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
export function copyLink(button: HTMLElement, text: string | null = null): void {
	const link = text === null ? publishNow().link : Promise.resolve(text);
	const group = $('[data-messages="copy-status"]', button)!;
	const saving = text === null;
	button.toggleAttribute("data-saving", saving);
	if (saving) button.setAttribute("aria-busy", "true");
	const done = (name: string) => {
		button.removeAttribute("data-saving");
		button.removeAttribute("aria-busy");
		if (saving && name === "copied") say("linkCopied");
		showMessage(group, name);
		button.toggleAttribute("data-copied", name === "copied");
		clearTimeout(copyTimers.get(button));
		copyTimers.set(button, setTimeout(() => { showMessage(group, "idle"); button.removeAttribute("data-copied"); }, 2200));
	};
	writeClipboard(link).then(() => done("copied"), () => done("failed")); // the clipboard holds the link only once it opens anywhere
}
// The example in the showcase shares itself: its own address (?book=&id=, the link that opens it) and its own caption, so its
// circles act from the first frame without the example being opened.
export const featuredUrl = (record: { book?: string; id?: string }): string => { const url = new URL(location.pathname, location.href); url.searchParams.set("book", record.book!); url.searchParams.set("id", record.id!); return url.href; };
export function shareFeatured(link: HTMLAnchorElement): void {
	const record = view.featured(link.dataset.featuredId);
	if (!record) return;
	link.href = intents(caption(record), featuredUrl(record))[link.dataset.shareFeatured ?? ""]!;
}
/** The end card's "Share this chapter": the card (desktop) is already in view; on a phone the masthead row is at the top of the page. */
export function showShare(): void {
	if (!state.record?.versions.length) return;
	if (!dashboard.matches) toTop();
	const icons = $(dashboard.matches ? '[data-cover-actions="card"]' : '[data-cover-actions="phone"]', root)!;
	$("[data-cover-native]:not([hidden]), [data-copy-link]", icons)?.focus({ preventScroll: !dashboard.matches });
}

/** The share hook of the renderer, the cover's load, and the showcase's links (real hrefs from the first frame: focusable, followable). */
export function initShare(): void {
	view.share = paintShare;
	$("[data-cover]", root)?.addEventListener("load", () => view.cover(root, seen()));
	for (const link of $$<HTMLAnchorElement>("[data-share-featured]", root)) shareFeatured(link);
}
