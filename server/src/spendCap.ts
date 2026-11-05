// The spend ceilings, one per provider (config.ts PROVIDERS): META_SPEND_CAP_USD for the Meta Model API, BASETEN_SPEND_CAP_USD for
// Baseten (USD at list price; unset or "" = no ceiling). Each running total is its provider's row of the `spend_ledger` table in D1
// (migrations/0005_spend_ledger.sql), so it survives deploys, isolates and restarts.
// Every model call RESERVES its estimate before it is sent, with one atomic UPDATE that succeeds only while the total stays within
// the cap, and BOOKS its actual cost afterwards (usage x list price; $0 for an unbilled failure; the estimate stays when the billing
// is unknown, e.g. a writer timeout; a picture call with no 2xx answer is $0). A refused reservation is a 402 spend_cap_reached, which the pipeline treats like its provider refusing our key:
// nothing more launches and the action ends (in the showcase state when that provider is Meta). Fail closed: a cap without the database, or a database that does not
// answer, sends no call.
import { RoleError } from "./errors";
import { PROVIDERS, type Env, type Price } from "./config";
import type { ProviderId } from "./prompts";
import type { Usage } from "./errors";

export interface Budget {
	provider: ProviderId;
	db: D1Database | null;
	capUsd: number;
}

export interface Hold {
	budget: Budget;
	estimateUsd: number;
}

/** What a call cost, as the model client fills it in while the call runs. */
export interface Bill {
	billable: boolean;
	model: string;
	price?: Price;
	usage?: Usage;
	costUsd?: number;
	/** A picture call got a 2xx answer (the provider delivered, so billed, whatever the body turns out to be). */
	answered?: boolean;
}

/** The provider's budget when this Worker sets its cap var, else null. */
export function budgetOf(env: Env, provider: ProviderId): Budget | null {
	const value = (env as unknown as Record<string, string | undefined>)[PROVIDERS[provider].capVar];
	if (value === undefined || value === null || String(value).trim() === "") return null;
	const capUsd = Number(value);
	return { provider, db: env.DB ?? null, capUsd: Number.isFinite(capUsd) && capUsd > 0 ? capUsd : 0 };
}

// Nothing was sent, so nothing is billed.
const unsent = (code: string, message: string, extra: { status?: number } = {}) => Object.assign(new RoleError(code, message, extra), { costUsd: 0, billed: false });

/** Reserves `estimateUsd` -> a hold for book(), or throws (402 spend_cap_reached once the budget is spent). */
export async function reserve(budget: Budget, estimateUsd: number | null): Promise<Hold> {
	const usd = Math.max(Number(estimateUsd) || 0, 0);
	const { capVar, name } = PROVIDERS[budget.provider];
	if (!budget.db) throw unsent("spend_guard_unavailable", `${capVar} is set but the DB database is not bound, so no call was sent.`);
	let row: unknown;
	try {
		// One atomic statement: the provider's first reservation creates its row; later ones add to it only while the total stays within the cap.
		row = await budget.db.prepare(`INSERT INTO spend_ledger (provider, usd, calls) SELECT ?1, ?2, 1 WHERE ?2 <= ?3
			ON CONFLICT (provider) DO UPDATE SET usd = usd + excluded.usd, calls = calls + 1 WHERE usd + excluded.usd <= ?3 RETURNING usd`).bind(budget.provider, usd, budget.capUsd).first();
	} catch (error) {
		throw unsent("spend_guard_unavailable", `The spend ledger did not answer, so no call was sent: ${(error as Error)?.message ?? error}`);
	}
	if (row) return { budget, estimateUsd: usd };
	if ((await spentUsd(budget)) === null) throw unsent("spend_guard_unavailable", "The spend ledger cannot be read (apply migrations/), so no call was sent.");
	throw unsent("spend_cap_reached", `The app's ${name} budget of ${budget.capUsd} is spent.`, { status: 402 });
}

/** What a finished call cost. */
export function actualUsd(bill: Bill | null | undefined, estimateUsd: number): number {
	if (!bill?.billable) return 0;
	if (Number.isFinite(bill.costUsd)) return bill.costUsd as number;
	const { usage, price } = bill;
	if (!usage || !price) return estimateUsd; // billed, amount unknown: the estimate stands
	const cached = usage.cache_read_tokens ?? 0;
	return (Math.max(usage.input_tokens - cached, 0) * price.input + cached * (price.cachedInput ?? price.input) + usage.output_tokens * price.output) / 1e6;
}

/** Replaces a hold's estimate with the call's actual cost. Never throws (the call already happened). */
export async function book(hold: Hold, bill: Bill): Promise<void> {
	const delta = actualUsd(bill, hold.estimateUsd) - hold.estimateUsd;
	if (!delta) return;
	try {
		await hold.budget.db!.prepare("UPDATE spend_ledger SET usd = MAX(usd + ?1, 0) WHERE provider = ?2").bind(delta, hold.budget.provider).run();
	} catch (error) {
		console.error(`[budget] a call's cost was not booked (off by $${delta.toFixed(4)})`, (error as Error)?.message ?? error);
	}
}

/** The provider's running total (0 before its first call), or null when the ledger cannot be read. */
export async function spentUsd(budget: Budget): Promise<number | null> {
	if (!budget.db) return null;
	try {
		return (await budget.db.prepare("SELECT usd FROM spend_ledger WHERE provider = ?1").bind(budget.provider).first<{ usd: number }>())?.usd ?? 0;
	} catch {
		return null;
	}
}
