// What the browser remembers besides the remixes themselves, and the address: `remix:ids` (book -> the remix last open on it),
// the session's drafts (`remix:drafts`, book -> { text, divergence }), and the URL (?book, ?id, ?share), pushed for the visitor's
// own steps so Back returns to them.
import { safeLocalStorage as local, safeSessionStorage as session, type SafeStorage } from "../lib/storage";
import { DRAFTS_KEY, FAST_KEY, IDS_KEY, THINKING_KEY } from "./constants";
import { dom, starting, state } from "./context";

export const read = <T = Record<string, unknown>>(store: SafeStorage, key: string): T => { try { return JSON.parse(store.getItem(key)!) || {}; } catch { return {} as T; } };
const write = (store: SafeStorage, key: string, value: unknown): void => { try { store.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: the URL still restores */ } };

export interface Draft { text?: unknown; divergence?: string | null }
export const readIds = (): Record<string, string> => read<Record<string, string>>(local, IDS_KEY);
export const readDrafts = (): Record<string, Draft | undefined> => read<Record<string, Draft | undefined>>(session, DRAFTS_KEY);

/** A remix id that leads nowhere (not in this browser, or nothing was written): the book forgets it. */
export function dropId(id: string): void {
	const ids = readIds();
	for (const book of Object.keys(ids)) if (ids[book] === id) delete ids[book];
	write(local, IDS_KEY, ids);
}
export function saveDraft(): void {
	const drafts = readDrafts();
	drafts[state.book] = { text: dom.request.value, divergence: state.divergenceId };
	write(session, DRAFTS_KEY, drafts);
}
export function clearDraft(book: string): void { const drafts = readDrafts(); delete drafts[book]; write(session, DRAFTS_KEY, drafts); }
export function forget(book: string): void { starting.delete(book); const ids = readIds(); delete ids[book]; write(local, IDS_KEY, ids); }
/** The book's remix is now `id` (a create accepted while the visitor was on another book: the address is not touched). */
export function keepId(book: string, id: string): void { const ids = readIds(); ids[book] = id; write(local, IDS_KEY, ids); }
/** Fast mode (one choice for writing and revising, remembered across visits; off unless stored). */
export const readFast = (): boolean => local.getItem(FAST_KEY) === "1";
export function saveFast(on: boolean): void { if (on) local.setItem(FAST_KEY, "1"); else local.removeItem(FAST_KEY); }
export type Thinking = "low" | "medium" | "high";
// Medium is the default: the stored key holds "low" or "high" only, absent means Medium.
export const readThinking = (): Thinking => { const step = local.getItem(THINKING_KEY); return step === "low" || step === "high" ? step : "medium"; };
export function saveThinking(step: string): void { if (step === "low" || step === "high") local.setItem(THINKING_KEY, step); else local.removeItem(THINKING_KEY); }
export function remember(): void { keepId(state.book, state.id!); syncUrl(true); }

/** push: a step the visitor took (create, book switch, example, New remix) is a history entry, so Back returns to it. */
export function syncUrl(push = false): void {
	const url = new URL(location.href);
	url.searchParams.set("book", state.book);
	url.searchParams.delete("restore");
	// A shared remix's address is its share link; anything else is the browser's own (?id).
	const shared = state.id?.startsWith("share:") ? state.id.slice(6) : null;
	if (shared) url.searchParams.set("share", shared); else url.searchParams.delete("share");
	if (state.id && !shared) url.searchParams.set("id", state.id); else url.searchParams.delete("id");
	if (push && url.href !== location.href) history.pushState(null, "", url); else history.replaceState(null, "", url);
}
