// DOM shorthands every module shares. `$` is one element, `$$` an array (a `for…of` over `$()` threw "is not iterable" once:
// site-build.md). Both default to HTMLElement, since the page's hooks are data attributes read through `dataset`.
export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null => root.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];
export const html = document.documentElement;
/** A value made safe inside an attribute selector. */
export const esc = (value: unknown): string => CSS.escape(String(value));
/** The closest `selector` match of an event target (null when the target is not an element). */
export const closest = <T extends Element = HTMLElement>(target: EventTarget | null, selector: string): T | null =>
	target instanceof Element ? target.closest<T>(selector) : null;
