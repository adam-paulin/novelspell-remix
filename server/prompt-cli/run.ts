// One run: entries -> validated inputs -> rendered prompts -> requests -> written to disk, and sent only when payloadOnly is off.
// Every prompt goes through the same steps whatever its kind; only the core's buildRequest tells a text request from an image request.
//
// Batching for the cache: text requests that share a model and a cacheable prefix form a group. When sending, each group's first
// request goes alone and the rest follow as soon as the model starts answering it (the prefix is cached by then); groups run side by
// side. Image requests have nothing to cache, so each is its own group.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { PROMPTS, buildRequest, cacheKey, modelOf, render, type Prompt } from "../src/prompts/index.js";
import { config } from "./config.js";
import { estimateUsd, send, type Request, type Sent } from "./send.js";

/** The entries file. Each entry names a prompt (src/prompts/index.ts PROMPTS) and gives its input; ids name the output files. */
const EntriesFile = z.strictObject({
	/** Optional JSON file that { "$ref": "a.b.c" } values point into (resolved relative to the entries file). */
	refs: z.string().optional(),
	entries: z.array(z.strictObject({
		id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "a plain file name: lowercase letters, digits, dot, underscore, dash"),
		prompt: z.string(),
		info: z.unknown().optional(),
		data: z.unknown(),
	})).min(1),
});
export type Entry = z.output<typeof EntriesFile>["entries"][number];

/** Replaces every { "$ref": "dotted.path" } with the value at that path in the refs file. */
function resolveRefs(value: unknown, refs: unknown): unknown {
	if (Array.isArray(value)) return value.map(item => resolveRefs(item, refs));
	if (!value || typeof value !== "object") return value;
	const object = value as Record<string, unknown>;
	if (typeof object.$ref === "string" && Object.keys(object).length === 1) {
		const found = object.$ref.split(".").reduce<unknown>((at, key) => (at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined), refs);
		if (found === undefined) throw new Error(`$ref "${object.$ref}" points at nothing${refs === undefined ? " (the entries file names no refs file)" : ""}.`);
		return found;
	}
	return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, resolveRefs(item, refs)]));
}

export interface Built {
	entry: Entry;
	prompt: Prompt;
	request: Request;
	group: string;
	prefixChars: number;
	suffixChars: number;
	estimateUsd: number;
	sent?: Sent;
}

/** Builds every entry's request. Fails before anything is sent if the file or any entry does not fit, naming the entry. */
export async function build(entriesPath: string): Promise<Built[]> {
	const parsed = EntriesFile.safeParse(JSON.parse(await readFile(entriesPath, "utf8")));
	if (!parsed.success) throw new Error(`${entriesPath}: ${z.prettifyError(parsed.error).replace(/\n/g, " ")}`);
	const file = parsed.data;
	const refs = file.refs ? JSON.parse(await readFile(resolve(dirname(entriesPath), file.refs), "utf8")) : undefined;
	const repeated = file.entries.map(entry => entry.id).find((id, index, ids) => ids.indexOf(id) !== index);
	if (repeated) throw new Error(`Entry id "${repeated}" is used twice.`);
	const prompts = PROMPTS as Record<string, Prompt>;
	return Promise.all(file.entries.map(async raw => {
		try {
			const prompt = prompts[raw.prompt];
			if (!prompt) throw new Error(`no prompt "${raw.prompt}" (have ${Object.keys(prompts).join(", ")}).`);
			const entry = resolveRefs(raw, refs) as Entry;
			const rendered = render(prompt, entry);
			const { path, body } = await buildRequest(prompt, rendered);
			const request: Request = { method: "POST", url: `${config.api.baseUrl}${path}`, body };
			return { entry: raw, prompt, request, group: prompt.output.kind === "json" ? `${prompt.model}:${(await cacheKey(rendered)).slice(0, 12)}` : `${prompt.model}:${raw.id}`, prefixChars: rendered.prefix.length, suffixChars: rendered.suffix.length, estimateUsd: estimateUsd(prompt, request) };
		} catch (error) { throw new Error(`${raw.id} (${raw.prompt}): ${error instanceof Error ? error.message : error}`); }
	}));
}

/** Sends every request: groups side by side, each group's first request alone, then the rest of the group. `onSent` runs as each lands. */
export async function sendAll(built: Built[], onSent: (item: Built) => Promise<void>): Promise<void> {
	const groups = Map.groupBy(built, item => item.group);
	const queue = limiter(config.concurrency);
	const sendOne = async (item: Built, onStarted?: () => void) => {
		item.sent = await queue(() => send(item.prompt, item.request, onStarted)).catch(error => ({ status: 0, ok: false, seconds: 0, problems: [String(error instanceof Error ? error.message : error)] }));
		onStarted?.(); // a failed call releases its group too
		await onSent(item);
	};
	await Promise.all([...groups.values()].map(async ([first, ...rest]) => {
		if (!first) return;
		let release = () => {};
		const started = new Promise<void>(resolve => { release = resolve; });
		await Promise.all([sendOne(first, release), started.then(() => Promise.all(rest.map(item => sendOne(item))))]);
	}));
}

/** At most `max` tasks at once. A finishing task hands its slot straight to the next waiting one, so a newcomer can never squeeze in. */
function limiter(max: number) {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		if (active >= max) await new Promise<void>(wake => waiting.push(wake));
		else active++;
		try { return await task(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
	};
}

/** <id>.request.json for every entry, written before anything is sent. */
export async function writeRequests(built: Built[], out: string): Promise<void> {
	await mkdir(out, { recursive: true });
	for (const item of built) await writeFile(join(out, `${item.entry.id}.request.json`), `${JSON.stringify(item.request, null, 2)}\n`);
}

/** <id>.answer.json (and the picture for an image prompt) of one sent entry, written as it lands. */
export async function writeAnswer(item: Built, out: string): Promise<void> {
	if (!item.sent) return;
	const model = modelOf(item.prompt), picture = model.kind === "image" ? `${item.entry.id}.${model.format === "png" ? "png" : "jpg"}` : null;
	if (item.sent.image && picture) await writeFile(join(out, picture), item.sent.image);
	await writeFile(join(out, `${item.entry.id}.answer.json`), `${JSON.stringify({ ...item.sent, image: item.sent.image ? `${picture} (${item.sent.image.length} bytes)` : undefined }, null, 2)}\n`);
}

/** summary.json: one line per entry (its cache group, sizes, estimate, and the outcome when sent). */
export async function writeSummary(built: Built[], out: string, sent: boolean): Promise<void> {
	const summary = {
		mode: sent ? "sent" : "payload-only",
		entries: built.map(item => ({
			id: item.entry.id, prompt: item.prompt.name, kind: item.prompt.output.kind, model: modelOf(item.prompt).id, url: item.request.url, cacheGroup: item.group,
			prefixChars: item.prefixChars, suffixChars: item.suffixChars, estimateUsd: Math.round(item.estimateUsd * 1e5) / 1e5,
			...(item.sent ? { ok: item.sent.ok, status: item.sent.status, seconds: item.sent.seconds, costUsd: item.sent.costUsd, problems: item.sent.problems } : {}),
		})),
	};
	await writeFile(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}
