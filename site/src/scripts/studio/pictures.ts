// The pictures' own actions: the lightbox (the comic full size with the what-if and its numbered panel beats; the cover with the
// caption only) and the downloads, saved from the picture's stored Blob (a compiled example's picture is read from this site first);
// any failure falls back to the plain link opening the picture.
import { $, closest } from "../lib/dom";
import { cloneTemplate, fillSlots, showMessage } from "../lib/messages";
import { lightbox, root, state } from "./context";
import { openDialog } from "./dialogs";
import { objectUrls, pictureAt } from "./records";
import { seen } from "./screen";
import type { Chapter, Picture } from "./types";
import { view } from "./view";

// The title and beats of the picture actually on screen (a replacement can still be loading behind it): the version whose comic it
// is. While a chapter is written, its newly drawn comic goes with the draft beats and the streamed title.
function comicWords(src: string): Chapter | null | undefined {
	const record = state.record;
	if (!record || !src) return null;
	const same = (image: Picture) => { const url = typeof image === "string" ? image : image ? objectUrls.get(image) : undefined; return !!url && src.split("?")[0] === url.split("?")[0]; };
	const entry = record.versions.find((item) => same(item.comic));
	if (entry) return entry.chapter;
	const writing = state.status === "writing";
	return writing ? { panels: state.run?.entry?.chapter?.panels } : seen()?.chapter;
}
// The cover (the card's picture, the phone thumbnail) opens in the same lightbox, with the caption and no beats.
export function openLightbox(kind = "comic", opener: Element | null = null): void {
	const cover = kind === "cover";
	const img = (cover && opener?.querySelector("img")) || $<HTMLImageElement>(cover ? "[data-cover]" : "[data-comic]", root); // the clicked picture (the phone thumbnail loads on its own)
	if (!lightbox || !img?.getAttribute("src") || img.hidden) return; // a picture still loading (or another remix's) is not opened
	const full = $<HTMLImageElement>("[data-lightbox-img]", lightbox)!;
	if (full.getAttribute("src") !== img.getAttribute("src")) {
		full.src = img.getAttribute("src")!;
	}
	// The dialog's and the picture's names are pre-rendered variants; data-kind also names the saved file (saveImage).
	showMessage($('[data-messages="lightbox-label"]', lightbox)!, kind);
	showMessage($('[data-messages="lightbox-alt"]', lightbox)!, kind);
	lightbox.dataset.kind = kind;
	const download = $<HTMLAnchorElement>("[data-lightbox-download]", lightbox);
	if (download) download.href = img.getAttribute("src")!;
	const words = comicWords($("[data-comic]", root)?.getAttribute("src") ?? "");
	fillSlots(lightbox, { lightboxTitle: view.smart(view.quote(seen() ?? state.record ?? {})) }); // the what-if the headline shows (the free demo's own, when it served one)
	const beats = cover ? [] : (words?.panels ?? []).map((panel) => panel?.beat).filter((beat): beat is string => !!beat);
	const list = $("[data-lightbox-list]", lightbox)!;
	const template = $<HTMLTemplateElement>("template[data-beat-row]", lightbox)!;
	list.replaceChildren(...beats.map((beat) => cloneTemplate(template, { beat: view.smart(beat) })));
	$("[data-lightbox-beats]", lightbox)!.hidden = !beats.length;
	openDialog(lightbox);
}

export const extensionOf = (blob: Blob): string => (blob.type.split("/")[1] || "jpeg").replace("jpeg", "jpg").replace("svg+xml", "svg");
export async function saveImage(link: Element): Promise<void> {
	const href = link.getAttribute("href");
	if (!href || href === "#") return;
	try {
		const blob = await pictureAt(href);
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		const named = link.matches("[data-lightbox-download]") && lightbox?.dataset.kind === "cover" ? $("[data-cover-download]", root) : link; // the cover keeps its own file name
		a.download = `${named?.getAttribute("download") ?? ""}.${extensionOf(blob)}`;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 4000);
	} catch { window.open(href, "_blank", "noopener"); }
}
/** Download links ([data-download-image]) in the lightbox and the studio save the picture instead of following. */
export function bindDownloads(): void {
	for (const host of [lightbox, root]) host?.addEventListener("click", (event) => {
		const link = closest(event.target, "[data-download-image]");
		if (!link) return;
		event.preventDefault();
		saveImage(link);
	});
}
