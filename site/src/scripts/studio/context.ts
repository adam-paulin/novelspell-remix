// The studio's shared state, made once by initContext when the page has a studio: its nodes, where the remix on screen stands,
// the actions in flight, the media queries the behaviour depends on. Every studio module reads these live bindings.
import { $, $$, html } from "../lib/dom";
import { breakpoints } from "../lib/breakpoints";
import { createHosting, type Hosting } from "./hosting";
import type { StreamLive } from "./view";
import type { Remix, RemixError, Run, Status } from "./types";

export interface Dom {
	request: HTMLTextAreaElement;
	composer: HTMLFormElement;
	steer: HTMLFormElement;
	instruction: HTMLTextAreaElement;
	/** The chapter pane: it scrolls on its own on desktop (the app never scrolls the page there). */
	page: HTMLElement | null;
}
// status: where the remix on screen is, error: why it is (code, stage, revision); run: the action in flight (actions.ts perform);
// viewing: the older version being read, or null for the current one; op: bumped by every step that takes the page over.
export interface State {
	book: string;
	id: string | null;
	record: Remix | null;
	divergenceId: string | null;
	lastRequest: string;
	lastPoint: string | null;
	lastBook: string | null;
	lastId: string | null;
	op: number;
	revising: boolean;
	action: "create" | "revise" | null;
	viewing: number | null;
	status: Status;
	error: RemixError | null;
	run: Run | null;
	previousText?: string;
}

export let root!: HTMLElement;
export let dom!: Dom;
export let state!: State;
export let hosting!: Hosting;
export let slugs!: string[];
export let preview!: HTMLDialogElement;
export let build!: HTMLDialogElement;
export let lightbox: HTMLDialogElement | null = null;
/** The dashboard (desktop): the page never scrolls there; long parts scroll inside their own panes. */
export let dashboard!: MediaQueryList;
export let coarse!: MediaQueryList;
export let reduceMotion!: MediaQueryList;
/** The chapter prose as it arrives: `live` is the paragraph bookkeeping of view.stream, `frame` the pending repaint. */
export const stream: { live: StreamLive | null; frame: number } = { live: null, frame: 0 };
// The actions still in flight, by remix id. A book switch or New remix leaves an action running into its own remix; opening that
// remix again re-adopts the action (restore -> adopt) instead of reading its half-saved copy from the store, which has no version
// yet and would be dropped (the visitor would write, and pay for, the same chapter twice).
export const live = new Map<string, Run>();
// The creates not accepted yet, by the book they were sent from: they have no remix id (it is made from the accepted line), so
// `live` and `remix:ids` cannot lead back to them. Coming back to the book re-adopts its create (workspace.ts resume); once it is
// accepted, its id is remembered for its book even when the visitor is elsewhere. The book forgetting its remix (New remix) drops it.
export const starting = new Map<string, Run>();

export function initContext(studio: HTMLElement): void {
	root = studio;
	dom = {
		request: $<HTMLTextAreaElement>("[data-request]", root)!,
		composer: $<HTMLFormElement>("[data-composer]", root)!,
		steer: $<HTMLFormElement>("[data-steer]", root)!,
		instruction: $<HTMLTextAreaElement>("[data-instruction]", root)!,
		page: $("[data-result-chapter]", root),
	};
	hosting = createHosting();
	preview = $<HTMLDialogElement>('dialog[data-modal="preview"]')!;
	build = $<HTMLDialogElement>('dialog[data-modal="build"]')!;
	lightbox = $<HTMLDialogElement>('dialog[data-modal="comic"]');
	slugs = $$("[data-rail-book]").map((node) => node.dataset.railBook!);
	const book = html.dataset.book;
	state = {
		book: book && slugs.includes(book) ? book : slugs[0]!, id: new URLSearchParams(location.search).get("id") || null, record: null,
		divergenceId: $("[data-composer]", root)?.dataset.divergence || null, lastRequest: "", lastPoint: null, lastBook: null, lastId: null,
		op: 0, revising: false, action: null, viewing: null, status: "ready", error: null, run: null,
	};
	dashboard = matchMedia(`(min-width: ${breakpoints.laptop.min})`);
	coarse = matchMedia("(pointer: coarse)");
	reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
}

/** Back to the top: the chapter pane's own scroll and the page's. */
export const toTop = (): void => { dom.page?.scrollTo({ top: 0, behavior: "instant" }); window.scrollTo({ top: 0, behavior: "instant" }); };
