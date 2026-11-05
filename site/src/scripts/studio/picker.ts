// The phone and tablet book picker (Shelf.astro, below 64rem): the sticky button opens the covers as a dropdown over the page, so
// opening, closing and picking never shift the layout or the scroll position. Closed, the list is display:none (CSS on
// [data-picker-open]), so its lazy covers are not fetched until the picker first opens. Opening focuses the selected cover; picking a
// book, Escape, a tap outside or Tab past the last cover closes it, and closing from inside returns focus to the button.
import { $, closest } from "../lib/dom";
import { state } from "./context";
import { scrollRail } from "./workspace";

export function bindPicker(): void {
	const rail = $("[data-rail]");
	const toggle = rail && $<HTMLButtonElement>("[data-picker-toggle]", rail);
	if (!rail || !toggle) return;
	const isOpen = () => rail.hasAttribute("data-picker-open");
	const set = (open: boolean, refocus = false) => {
		rail.toggleAttribute("data-picker-open", open);
		toggle.setAttribute("aria-expanded", String(open));
		if (open) {
			scrollRail(state.book, "instant");
			$(`[data-target-book="${state.book}"]`, rail)?.focus({ preventScroll: true });
		} else if (refocus) toggle.focus({ preventScroll: true });
	};
	toggle.addEventListener("click", () => set(!isOpen()));
	rail.addEventListener("click", (event) => { if (isOpen() && closest(event.target, "[data-target-book]")) set(false, true); });
	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || !isOpen()) return;
		event.preventDefault();
		set(false, rail.contains(document.activeElement));
	});
	document.addEventListener("pointerdown", (event) => { if (isOpen() && event.target instanceof Node && !rail.contains(event.target)) set(false); });
	rail.addEventListener("focusout", (event) => { if (isOpen() && event.relatedTarget instanceof Node && !rail.contains(event.relatedTarget)) set(false); });
}
