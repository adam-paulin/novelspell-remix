// The shared layout's behaviour on every page (the port of the framework's browserInteractions.js): keyboard focus kept inside the
// visible band and the theme (toggle buttons and system changes). The blocking head script only paints the first theme; everything
// that changes it afterwards lives here.
import { safeLocalStorage } from "./lib/storage";

type Theme = "light" | "dark";
interface ThemeApi {
	storageKey: string;
	getStoredTheme(): Theme | null;
	getSystemTheme(): Theme | null;
	getTheme(): string;
	applyTheme(theme?: string): string;
}
declare global {
	interface WindowEventMap { themechange: CustomEvent<{ theme?: string }> }
}

const THEME_STORAGE_KEY = "theme";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

// The two theme-color values are the ones the head already carries in its media-specific <meta name="theme-color"> tags.
const themeApi: ThemeApi = {
	storageKey: THEME_STORAGE_KEY,
	getStoredTheme: () => {
		const theme = safeLocalStorage.getItem(THEME_STORAGE_KEY);
		return theme === "light" || theme === "dark" ? theme : null;
	},
	getSystemTheme: () => {
		const query = window.matchMedia?.(SYSTEM_THEME_QUERY);
		return query ? (query.matches ? "dark" : "light") : null;
	},
	getTheme: () => themeApi.getStoredTheme() || themeApi.getSystemTheme() || document.documentElement.dataset.theme || "light",
	applyTheme: (theme = themeApi.getTheme()) => {
		document.documentElement.dataset.theme = theme;
		document.documentElement.classList.toggle("dark", theme === "dark");
		const color = document.querySelector<HTMLMetaElement>(`meta[name="theme-color"][media*="${theme}"]`)?.content;
		if (color) document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", color);
		window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
		return theme;
	},
};
const getNextTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "light" : "dark");

export default function initLayout(): void {
	alignOversizedFocusTarget();
	syncSystemThemeChanges();
	syncThemeToggleControl();
}

// Native keyboard focus cannot align a target taller than the visible band (Chromium leaves it straddling both edges), and a textarea
// caret can stay behind the header. Root scroll-padding (CSS) already defines that band, so this reads it (nothing is measured): after
// the browser's own focus action, keyboard focus moves into the band; a target taller than the band aligns its top edge below the
// header. Pointer focus never scrolls.
function alignOversizedFocusTarget(): void {
	document.addEventListener("focusin", (event) => {
		const target = event.target;
		if (!(target instanceof Element) || !target.closest("main,footer")) return;
		requestAnimationFrame(() => {
			if (document.activeElement !== target || !target.matches(":focus-visible")) return;
			const style = getComputedStyle(document.documentElement);
			const top = parseFloat(style.scrollPaddingTop) || 0;
			const bottom = innerHeight - (parseFloat(style.scrollPaddingBottom) || 0);
			const box = target.getBoundingClientRect();
			if (box.width <= 0 || box.height <= 0 || bottom <= top || (box.top >= top && box.bottom <= bottom)) return;
			const delta = box.height > bottom - top || box.top < top ? box.top - top : box.bottom - bottom;
			// Round away from the covered edge so subpixel target boxes clear it.
			window.scrollTo({ top: Math.max(0, Math[delta < 0 ? "floor" : "ceil"](scrollY + delta)), behavior: "instant" });
		});
	});
}

// No stored choice: the theme follows the system's.
function syncSystemThemeChanges(): void {
	const query = window.matchMedia?.(SYSTEM_THEME_QUERY);
	if (!query) return;
	const sync = () => { if (!themeApi.getStoredTheme()) themeApi.applyTheme(); };
	query.addEventListener("change", sync); // (the framework's addListener fallback is for browsers below the build targets)
}

// Every rendered ThemeToggle on the page (the header's, plus the side panel's own): each shows the label of the theme it switches to.
function syncThemeToggle(button: HTMLElement, theme = document.documentElement.dataset.theme): void {
	for (const label of button.querySelectorAll<HTMLElement>("[data-theme-label]")) label.hidden = label.dataset.themeLabel !== (theme === "dark" ? "light" : "dark");
}
function syncThemeToggleControl(): void {
	const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-theme-toggle]")];
	if (!buttons.length) return;
	const sync = (theme?: string) => { for (const button of buttons) syncThemeToggle(button, theme); };
	sync(document.documentElement.dataset.theme || themeApi.getTheme());
	for (const button of buttons) button.addEventListener("click", () => {
		const next = getNextTheme();
		safeLocalStorage.setItem(themeApi.storageKey, next);
		themeApi.applyTheme(next);
		sync(next);
	});
	window.addEventListener("themechange", (event) => sync(event.detail?.theme));
}
