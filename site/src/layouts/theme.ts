// The page shell's first-paint script (the framework's head script, same behaviour): inline and blocking in <head>
// (src/lib/inlineScript.ts), so the first frame is already in the visitor's theme. Serialised with toString: it may use only
// browser globals and its arguments.

/**
 * The stored theme (localStorage "theme"), else the system one, on <html data-theme> and .dark, and the matching browser UI colour on
 * the media-less theme-color meta. A hash link lands without the smooth scroll; it comes back two frames after load.
 */
export function themeHead(colors: { light: string; dark: string }): void {
	let theme: string | null = null;
	try { theme = localStorage.getItem("theme"); } catch {}
	if (theme !== "light" && theme !== "dark") theme = "matchMedia" in window ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : "light";
	const root = document.documentElement;
	root.dataset.theme = theme;
	root.classList.toggle("dark", theme === "dark");
	document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", theme === "dark" ? colors.dark : colors.light);
	if (location.hash) {
		root.style.scrollBehavior = "auto";
		addEventListener("load", () => requestAnimationFrame(() => requestAnimationFrame(() => root.style.removeProperty("scroll-behavior"))), { once: true });
	}
}
