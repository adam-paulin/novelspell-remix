// The studio's two text fields: the composer's what-if (with the turning point it was picked for) and the revise dock's instruction
// (with its quick ideas).
import { $$ } from "../lib/dom";
import { chipOf, exampleOf, pressPoints } from "./page-data";
import { coarse, dom, root, state } from "./context";

// A turning point stays picked only while the box holds exactly its words (its chip's what-if, or the book's example, which is
// written for its own turning point): an emptied or edited box is the visitor's own what-if.
export function syncPoint(): void {
	if (!state.divergenceId) return;
	const chip = chipOf(root, state.book, state.divergenceId);
	const example = exampleOf(state.book);
	const own = dom.request.value === chip?.dataset.whatif || (dom.request.value === example.text && state.divergenceId === example.divergence);
	if (!dom.request.value.trim() || !own) { state.divergenceId = null; pressPoints(root, state.book, null); }
}
/** A turning point or New remix: the box takes the text. A phone does not get its keyboard over the list and Write. */
export function focusRequest(): void {
	if (coarse.matches) { dom.request.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
	dom.request.focus();
	dom.request.setSelectionRange(dom.request.value.length, dom.request.value.length);
}

// A wrapping field that grows to about four lines: native where field-sizing exists (CSS), else sized from its content here.
let nativeGrow: boolean | null = null;
export function growInstruction(): void {
	if ((nativeGrow ??= CSS.supports("field-sizing", "content"))) return;
	dom.instruction.style.setProperty("height", "auto");
	dom.instruction.style.setProperty("height", `${dom.instruction.scrollHeight}px`);
}
/** A quick idea is pressed only while the field holds exactly its text. */
export function syncIdeas(): void {
	for (const idea of $$("[data-idea]", root)) idea.setAttribute("aria-pressed", String(!!dom.instruction.value && idea.dataset.text === dom.instruction.value));
}
export function setInstruction(text: string): void { dom.instruction.value = text; growInstruction(); syncIdeas(); }
