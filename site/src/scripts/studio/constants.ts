// The studio's fixed numbers and browser keys. The keys are shared with the Studio section's first-paint scripts (and with every
// remix the dev site saved), so they never change.
import { site } from "../../config";

/** The Remix API origin (`/api/*` is appended): build-time, src/config.ts (PUBLIC_API_URL). */
export const api: string = site.api;
export const BRIEF_CAP = 25000; // the whole hand-off brief (book, replaced chapter, the full new chapter): NovelSpell /custom's limits.brief
export const IMAGE_RETRIES = [1500, 4000, 10000, 20000]; // a compiled example's picture that fails to load (a stored one is a local Blob: no retry)
export const NOTICE_MS = 8000; // the hosted demo's paused notice
export const TEXT_SIZES = 5; // reader text-size steps (data-text-size 0..4; the sizes are CSS)
export const IDS_KEY = "remix:ids"; // book -> the id of the remix last open on it
export const DRAFTS_KEY = "remix:drafts"; // sessionStorage: book -> { text, divergence }
export const BOOK_KEY = "remix:book";
export const SIZE_KEY = "remix:text-size";
export const THINKING_KEY = "remix:thinking"; // "medium" | "high": the thinking step (the request's thinking); absent: Low. ModelSettings' first paint reads it too
export const FAST_KEY = "remix:fast"; // "1": Fast mode on (Muse Spark Open writes and revises); absent: off. FastToggle's first paint reads it too
export const DB_NAME = "novelspell-remix";
export const DB_STORE = "remixes";
/** The server-record era's browser copies (first paint would read them as a cached remix): removed at start. */
export const LEGACY_KEYS = ["remix:records", "remix:owners"];
