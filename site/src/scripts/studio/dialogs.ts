// The studio's dialogs (dialog[data-modal]): a click on the backdrop or a [data-close-dialog] closes them; on phones the sheet handle
// drags them down (attributes + a CSS variable; the motion is CSS); and the legal dialog answers the footer links with the Terms and
// Privacy compiled into it.
import { $, $$, esc } from "../lib/dom";

export function openDialog(dialog: HTMLDialogElement): void { if (!dialog.open) dialog.showModal(); }

export function bindDialogs(): void {
	for (const dialog of $$<HTMLDialogElement>("dialog[data-modal]")) {
		dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
		for (const close of $$("[data-close-dialog]", dialog)) close.addEventListener("click", () => dialog.close());
	}
	// The sheet handle (phones): drag it down past 80px, or tap it, and the sheet closes; a shorter drag springs back. While dragging
	// the dialog carries data-dragging and its offset as --sheet-drag (the rule that moves it is the dialogs' CSS).
	for (const grab of $$("[data-classlist~='remix-sheet-grab']")) {
		const dialog = grab.closest("dialog")!;
		let startY: number | null = null;
		grab.addEventListener("pointerdown", (event) => { startY = event.clientY; grab.setPointerCapture(event.pointerId); dialog.setAttribute("data-dragging", ""); });
		grab.addEventListener("pointermove", (event) => { if (startY !== null) dialog.style.setProperty("--sheet-drag", `${Math.max(0, event.clientY - startY)}px`); });
		const release = (event: PointerEvent) => {
			if (startY === null) return;
			const drag = event.clientY - startY;
			startY = null;
			dialog.removeAttribute("data-dragging");
			dialog.style.removeProperty("--sheet-drag");
			if (event.type === "pointerup" && (drag > 80 || Math.abs(drag) < 6)) dialog.close();
		};
		grab.addEventListener("pointerup", release);
		grab.addEventListener("pointercancel", release);
	}
	bindLegal();
}

// Footer links (Terms, Privacy, Contact): the links stay real (/terms/, /privacy/, mailto:), and a plain click opens
// dialog[data-modal="legal"] instead (the framework footer, and the shelf's own copy of its links). Each title variant in the dialog
// carries the url of the link it answers (data-legal-url). Terms and Privacy are compiled into the dialog
// (template[data-legal-text="terms|privacy"], keyed by the title's data-legal-title) and cloned on open; Contact is compiled in as
// markup. A link with nothing compiled for it simply navigates.
function bindLegal(): void {
	const legal = $<HTMLDialogElement>('dialog[data-modal="legal"]');
	if (!legal) return;
	const titles = $$("[data-legal-title]", legal);
	const parts = { text: $("[data-legal-text]:not(template)", legal)!, contact: $("[data-legal-contact]", legal)!, body: $("[data-legal-body]", legal)!, full: $("[data-legal-full]", legal) };
	const textOf = (title: HTMLElement) => $<HTMLTemplateElement>(`template[data-legal-text="${esc(title.dataset.legalTitle)}"]`, legal);
	const variantFor = (link: Element) => titles.find((title) => title.dataset.legalUrl === link.getAttribute("href"));
	function openLegal(title: HTMLElement) {
		const url = title.dataset.legalUrl!;
		const template = textOf(title);
		legal!.toggleAttribute("data-text", !!template);
		for (const node of titles) node.hidden = node !== title;
		parts.contact.hidden = !!template;
		parts.text.hidden = !template;
		parts.text.replaceChildren(...(template ? [template.content.cloneNode(true)] : []));
		if (template && parts.full) parts.full.setAttribute("href", url);
		parts.body.scrollTo({ top: 0, behavior: "instant" });
		openDialog(legal!);
	}
	document.addEventListener("click", (event) => {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const target = event.target instanceof Element ? event.target : null;
		const link = target?.closest("[data-footer-links] a[href]");
		const title = link && variantFor(link);
		if (!title || (title.dataset.legalUrl!.startsWith("/") && !textOf(title))) return;
		event.preventDefault();
		openLegal(title);
	});
}
