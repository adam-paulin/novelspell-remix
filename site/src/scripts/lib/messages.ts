// Page messages (the port of the framework's pageMessages.js). Every message a page can show is rendered at build time from
// content inside a `data-messages` group as `data-message="<name>"` variants (hidden until chosen). Scripts never write words:
// they pick which variant shows and fill runtime-only values into `data-slot` spans.
//
//   showMessage(group, "order", { order: "A-1042" });   // shows that variant with its slot filled
//   showMessage(group, null);                            // hides every variant

export type SlotValues = Record<string, string | number | null | undefined>;

const variantsOf = (group: HTMLElement): HTMLElement[] =>
	[...group.querySelectorAll<HTMLElement>("[data-message]")].filter((node) => node.closest("[data-messages]") === group);

/** Fills every `data-slot` under `root` that `values` names (the others keep their text). */
export function fillSlots<T extends ParentNode>(root: T, values: SlotValues = {}): T {
	for (const node of root.querySelectorAll<HTMLElement>("[data-slot]")) {
		const slot = node.dataset.slot ?? "";
		if (Object.hasOwn(values, slot)) node.textContent = String(values[slot] ?? "");
	}
	return root;
}

/** Shows the variant `name` of `group` (null hides them all) and returns it; a name with no rendered variant throws. */
export function showMessage(group: HTMLElement, name: string | null, values: SlotValues = {}): HTMLElement | null {
	let shown: HTMLElement | null = null;
	for (const node of variantsOf(group)) {
		node.hidden = node.dataset.message !== name;
		if (!node.hidden) shown = fillSlots(node, values);
	}
	if (name != null && !shown) throw new Error(`page message "${name}" is not rendered in group "${group.dataset.messages}"`);
	return shown;
}

// The tab title: the text of a rendered variant of `group` (e.g. "Writing…" while a long job runs), or the page's own title again
// (name null). The page's own title is read once, when the script starts.
const pageTitle = document.title;
export function showTitle(group: HTMLElement, name: string | null): string {
	const node = name == null ? null : variantsOf(group).find((item) => item.dataset.message === name);
	if (name != null && !node) throw new Error(`page message "${name}" is not rendered in group "${group.dataset.messages}"`);
	document.title = node ? (node.textContent ?? "").trim() : pageTitle;
	return document.title;
}

/** Clones a build-time `<template>`'s first element and fills its slots with runtime values. */
export function cloneTemplate<T extends Element = HTMLElement>(template: HTMLTemplateElement, values: SlotValues = {}): T {
	return fillSlots(template.content.firstElementChild!.cloneNode(true) as T, values);
}
