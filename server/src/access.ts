// Who may call this API from a browser, and who may START work (create, revise, redraw, share).
import type { Env } from "./config";

// SITE_ORIGINS: the static site(s) this backend serves, comma separated (e.g. https://your-site.example, http://localhost:3190 locally).
const siteOrigins = (env: Env) => String(env.SITE_ORIGINS ?? "").split(",").map(item => item.trim()).filter(Boolean);

/** The Origin header value when that page may call this API (CORS), else null. */
export const allowedOrigin = (env: Env, origin: string | null | undefined): string | null => (origin && siteOrigins(env).includes(origin) ? origin : null);

/**
 * Starting work needs a page on this origin or a SITE_ORIGINS origin, or a non-browser client (curl, scripts: no Origin header and no
 * cross-site fetch metadata). Browsers always send Origin on a cross-origin POST, including a "simple" text/plain one that skips the
 * CORS preflight, so no other page can spend the model credits through a visitor's browser.
 */
export function trustedOrigin(request: Request, env: Env): boolean {
	const origin = request.headers.get("origin");
	if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
	return origin === new URL(request.url).origin || Boolean(allowedOrigin(env, origin));
}
