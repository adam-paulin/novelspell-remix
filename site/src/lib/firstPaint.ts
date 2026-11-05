// The studio's first-paint scripts: inline and blocking (src/lib/inlineScript.ts), so the page's first frame already shows the right
// book, a restore in progress and the composer's text. Each is serialised with toString: it may use only browser globals and its
// arguments.

/**
 * Before the studio markup: the targeted book (featured remix, cached remix, ?book, the last book, else the first) on
 * <html data-book>, a restore (?id) on <html data-restore> ("snapshot" when the record is cached here or compiled in), and
 * <html data-featured> for a remix this browser may not revise. A shared remix (?share) is read-only, fetched by the studio.
 */
export function studioHead(slugs: string[], featured: Record<string, string>): void {
	const html = document.documentElement;
	const read = (store: Storage, key: string) => { try { return JSON.parse(store.getItem(key) as string); } catch { return null; } };
	try {
		const params = new URLSearchParams(location.search);
		const id = params.get("id") || null;
		const cached = id ? (read(localStorage, "remix:records") || {})[id] : null;
		const snapshot = !!(cached && cached.record && cached.record.id === id);
		const isFeatured = !!id && Object.hasOwn(featured, id);
		const share = id ? null : params.get("share");
		let book = isFeatured ? featured[id as string] : snapshot && slugs.includes(cached.record.book) ? cached.record.book : params.get("book");
		if (!slugs.includes(book)) { try { book = localStorage.getItem("remix:book"); } catch {} }
		html.dataset.book = slugs.includes(book) ? book : slugs[0];
		if (id) html.setAttribute("data-restore", snapshot || isFeatured ? "snapshot" : "");
		const owners = read(localStorage, "remix:owners") || {};
		if (isFeatured || (id && typeof owners[id] !== "string")) html.setAttribute("data-featured", "");
		if (share) { html.setAttribute("data-restore", ""); html.setAttribute("data-featured", ""); }
	} catch {}
}

/** After the studio markup: the composer's turning point pressed, and a cold restore (no snapshot) shown as restoring. */
export function studioTail(): void {
	const root = (document.currentScript as HTMLScriptElement).parentElement as HTMLElement;
	const html = document.documentElement;
	const book = html.dataset.book;
	const form = root.querySelector<HTMLElement>("[data-composer]");
	const divergence = (form && form.dataset.divergence) || "";
	for (const chip of root.querySelectorAll<HTMLElement>('[data-classlist~="remix-points-book"] [data-chip]')) chip.setAttribute("aria-pressed", String(!!divergence && chip.dataset.divergence === divergence && (chip.closest("[data-book-panel]") as HTMLElement).dataset.bookPanel === book));
	if (html.getAttribute("data-restore") === "") { root.dataset.phase = "restoring"; root.setAttribute("data-busy", ""); root.dataset.panels = "0"; }
}

/**
 * Inside the composer form, before first paint: the box takes this tab's draft for the selected book, else the book's example;
 * the form records the turning point to press (studioTail reads data-divergence).
 */
export function composerStart(): void {
	const form = (document.currentScript as HTMLScriptElement).parentElement as HTMLElement;
	const book = document.documentElement.dataset.book;
	let draft = null;
	try { draft = (JSON.parse(sessionStorage.getItem("remix:drafts") as string) || {})[book as string]; } catch {}
	const panel = document.querySelector<HTMLElement>('[data-example][data-book-panel="' + book + '"]');
	const start = draft && typeof draft.text === "string"
		? { text: draft.text, divergence: typeof draft.divergence === "string" ? draft.divergence : "" }
		: { text: panel ? panel.dataset.example : "", divergence: (panel && panel.dataset.examplePoint) || "" };
	const request = form.querySelector<HTMLTextAreaElement>("[data-request]");
	if (request && request.value !== start.text) request.value = start.text as string;
	form.dataset.divergence = start.divergence;
}

/**
 * Inside each Fast mode toggle (FastToggle.astro), before first paint: its switch shows the stored choice (`remix:fast` is "1"
 * when on; off by default), so every copy of the toggle paints in the right state.
 */
export function fastStart(): void {
	const input = ((document.currentScript as HTMLScriptElement).parentElement as HTMLElement).querySelector<HTMLInputElement>("[data-fast]");
	let on = false;
	try { on = localStorage.getItem("remix:fast") === "1"; } catch {}
	if (input) input.checked = on;
}

/**
 * Inside each settings capsule (ModelSettings.astro), before first paint: its thinking step shows the stored choice
 * (`remix:thinking` is "low" or "high"; Medium when absent), so every copy paints in the right state.
 */
export function thinkingStart(): void {
	const group = (document.currentScript as HTMLScriptElement).parentElement as HTMLElement;
	let step = "medium";
	try { step = localStorage.getItem("remix:thinking") || "medium"; } catch {}
	const input = group.querySelector<HTMLInputElement>(`[data-thinking][value="${step}"]`);
	if (input) input.checked = true;
}
