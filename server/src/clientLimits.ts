// How much one client may start. The spend caps (spendCap.ts) bound what the whole app can spend; these limits keep one client (a
// script in a loop, say) from spending it all and putting every other visitor in the showcase state. A client is its IP address
// (Cloudflare's cf-connecting-ip), stored only as a salted hash.
//   per minute  ACTION_LIMITER, Cloudflare's rate-limit binding (wrangler.jsonc "ratelimits"): every create, revise, redraw and share
//   per day     ACTION_DAILY_LIMIT model actions (create, revise, redraw) per client per UTC day, counted in D1 (migrations/0006);
//               unset or "" = no daily limit. Shares are not counted: they call no model.
// A refusal is a 429 before anything is sent. The limits fail open: when the binding or the database does not answer, the action
// goes ahead (the spend caps still hold, and they fail closed).
import type { Env } from "./config";

export type LimitRefusal = { code: "rate_limited" | "daily_limit"; message: string; retryAfterS: number };

const encoder = new TextEncoder();

/** The client's key: a salted SHA-256 of its IP (no address is stored), "local" without one (wrangler dev, tests). */
async function clientKey(request: Request, env: Env): Promise<string> {
	const ip = request.headers.get("cf-connecting-ip");
	if (!ip) return "local";
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${env.VERSION_SECRET ?? ""}|${ip}`));
	return [...new Uint8Array(digest).subarray(0, 12)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const secondsToMidnightUtc = () => Math.ceil((new Date().setUTCHours(24, 0, 0, 0) - Date.now()) / 1000);

/** The reason this client may not start `kind` now, or null. `model`: the action calls a model (counted against the daily limit). */
export async function limitRefusal(request: Request, env: Env, { model }: { model: boolean }): Promise<LimitRefusal | null> {
	const key = await clientKey(request, env);
	try {
		if (env.ACTION_LIMITER && !(await env.ACTION_LIMITER.limit({ key })).success) return { code: "rate_limited", message: "Too many requests from this connection. Wait a minute and try again.", retryAfterS: 60 };
	} catch (error) {
		console.error("[limits] rate limiter", (error as Error)?.message ?? error);
	}
	const daily = Number(env.ACTION_DAILY_LIMIT);
	if (!model || !env.DB || !env.ACTION_DAILY_LIMIT || !(daily > 0)) return null;
	const day = new Date().toISOString().slice(0, 10);
	try {
		// One atomic statement: the client's first action of the day creates its row; later ones count only while under the limit.
		const row = await env.DB.prepare(`INSERT INTO client_actions (day, client, n) VALUES (?1, ?2, 1)
			ON CONFLICT (day, client) DO UPDATE SET n = n + 1 WHERE n < ?3 RETURNING n`).bind(day, key, daily).first();
		return row ? null : { code: "daily_limit", message: `This connection has used today's ${daily} remixes. Come back tomorrow.`, retryAfterS: secondsToMidnightUtc() };
	} catch (error) {
		console.error("[limits] daily count", (error as Error)?.message ?? error);
		return null;
	}
}
