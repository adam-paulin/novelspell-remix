// The two roles the pipeline drives, each a retry chain (retryChain.ts) around one Meta call (metaClient.ts):
//   writer       write({ data, trace, deadline, onAttempt, onAttemptEnd, halted }) -> the validated { events, chapter } answer
//   illustrator  illustrate({ jobs, trace, deadline, stopped, halted }) -> the drawn images
// and the in-memory streams the writer appends its answer to while the pipeline reads them.
import { RoleError, type Failure, type Attempt, type Usage } from "./errors";
import { DEFAULT_THINKING, type Thinking } from "./prompts";
import { runChain } from "./retryChain";
import { drawOnce, stopsChain, writeOnce, type ChapterAnswer, type Halted, type Illustration, type ImageJob, type StreamLine, type WriterStreams } from "./metaClient";
import { ILLUSTRATOR_MODEL, WRITERS, roleConfig, type Env, type KeepAlive, type RoleConfig, type WriterMode } from "./config";
import type { PresetTally } from "./presetRuns";

export interface Trace {
	remixId: string;
	version: number;
}

/**
 * In-memory stream files: each writer call appends `start`, one `d` per answer delta and `end` lines to its own path; read() returns
 * the lines after `offset`, waiting up to `waitMs` for a new one (resolving the moment a line lands), or null while the path does
 * not exist yet. One set per action, so nothing outlives the request.
 */
export function memoryStreams(): WriterStreams & { read(path: string, offset: number, waitMs: number): Promise<StreamLine[] | null> } {
	const files = new Map<string, { lines: StreamLine[]; waiters: Set<() => void> }>();
	return {
		append(path, ...messages) {
			let target = files.get(path);
			if (!target) files.set(path, target = { lines: [], waiters: new Set() });
			target.lines.push(...messages);
			for (const wake of target.waiters) wake();
		},
		async read(path, offset, waitMs) {
			const target = files.get(path);
			if (!target) return null;
			const wait = Math.min(waitMs, 20_000);
			if (target.lines.length <= offset && wait > 0) {
				await new Promise<void>(resolve => {
					const done = () => { clearTimeout(timer); target.waiters.delete(done); resolve(); };
					const timer = setTimeout(done, wait);
					target.waiters.add(done);
				});
			}
			return target.lines.slice(offset);
		},
	};
}

export interface AttemptStart {
	provider: string;
	n: number;
	stream: string;
	run: string;
}

export interface AttemptEnd {
	run: string;
	n: number;
	provider: string;
	outcome: string;
	status?: number;
	usage?: Usage | null;
	costUsd?: number;
}

export interface WriteInput {
	/** The prompt's INFO (the book and the chapter cut at the fork) and DATA (the reader's input): prompts writer / revise. */
	info: Record<string, unknown>;
	data: Record<string, unknown>;
	trace: Trace;
	deadline: number;
	/** Called (and awaited) before every writer call, with the path of the stream that call will write. */
	onAttempt?: (info: AttemptStart) => unknown;
	/** Called after every writer call, whatever its outcome. */
	onAttemptEnd?: (info: AttemptEnd) => unknown;
	/** An Error once the action was stopped: thrown before every launch or retry, and checked again right before the request is sent. */
	halted?: Halted;
	/** Which writer (config.ts WRITERS): "fast" is the reader's Fast mode. Default "normal". */
	mode?: WriterMode;
	/** The reader's thinking dial: the writer's effort. Default DEFAULT_THINKING (medium). */
	thinking?: Thinking;
}

function writerRole(config: RoleConfig, streams: WriterStreams) {
	return {
		async write({ info, data, trace, deadline, onAttempt, onAttemptEnd, halted, mode = "normal", thinking = DEFAULT_THINKING }: WriteInput): Promise<{ asset: ChapterAnswer; provider: string; model: string; effort: string | null; attempts: Attempt[] }> {
			const entry = WRITERS[mode][thinking];
			// One stream path per writer execution and call, so no reader can ever pick up another call's answer.
			const run = crypto.randomUUID().slice(0, 8);
			const ended = (info: Omit<AttemptEnd, "run">) => Promise.resolve(onAttemptEnd?.({ run, ...info })).catch(error => console.error("[writer] attempt end", error?.message ?? error));
			const { value, provider, attempts } = await runChain({
				providers: [entry.provider], retries: config.retry.retries, retry: config.retry, deadline,
				call: async (key, n) => {
					const halt = halted?.();
					if (halt) throw halt;
					try {
						const stream = `meta:${trace.remixId}/v${trace.version}/${run}-${n}`;
						await onAttempt?.({ provider: key, n, stream, run });
						const result = await writeOnce(config, streams, { entry, info, data, path: stream, timeoutMs: Math.min(config.writer.timeoutMs, Math.max(deadline - Date.now(), 1000)), halted });
						await ended({ n, provider: key, outcome: "ok", usage: result.usage ?? null });
						return result;
					} catch (error) {
						const failure = error as RoleError;
						await ended({ n, provider: key, outcome: failure?.dispatched === false ? "stopped" : failure?.code ?? "failed", status: failure?.status ?? undefined, usage: failure?.usage, costUsd: failure?.costUsd });
						throw stopsChain(error, key);
					}
				},
			});
			const last = attempts.at(-1) as (Attempt & { firstDeltaMs?: number }) | undefined;
			if (value.usage && last?.outcome === "ok") last.usage = value.usage;
			if (value.firstDeltaMs != null && last?.outcome === "ok") last.firstDeltaMs = value.firstDeltaMs; // call start -> first answer token
			return { asset: value.asset, provider, model: entry.model, effort: entry.effort, attempts };
		},
	};
}

export interface IllustrateInput {
	jobs: ImageJob[];
	trace: Trace;
	deadline: number;
	/** True once the caller closed: no new launch may start. */
	stopped?: () => boolean;
	/** The action's real stop (a Meta 401/402/403), thrown as is before every launch or retry. */
	halted?: Halted;
}

function illustratorRole(config: RoleConfig) {
	return {
		async illustrate({ jobs, deadline, stopped, halted }: IllustrateInput): Promise<Illustration> {
			const started = Date.now();
			// The reason no launch may start (the action's real stop first, else the closed caller), or null. Re-checked right before each dispatch.
			const cancel = (): Failure | null => halted?.() ?? (stopped?.() ? new RoleError("stopped", "Picture drawing was closed before this launch.") : null);
			const { value, provider, attempts } = await runChain({
				providers: [ILLUSTRATOR_MODEL.provider], retries: config.illustrator.retries, retry: config.retry, deadline,
				call: async key => {
					try {
						const halt = cancel();
						if (halt) throw halt;
						const timeoutMs = Math.min(config.illustrator.timeoutMs, Math.max(deadline - Date.now(), 1000));
						const images = await drawOnce(config, { entry: ILLUSTRATOR_MODEL, jobs, timeoutMs, halted: cancel });
						return { images, seconds: (Date.now() - started) / 1000 };
					} catch (error) {
						throw stopsChain(error, key);
					}
				},
			});
			return { images: value.images, provider, model: ILLUSTRATOR_MODEL.model, seconds: value.seconds, attempts };
		},
	};
}

/** The roles of one action, sharing its config and its in-memory writer streams. */
export function createRoles(env: Env, tally: PresetTally | null, keepAlive: KeepAlive | null = null) {
	const config = roleConfig(env, tally, keepAlive);
	const streams = memoryStreams();
	return { config, streams, writer: writerRole(config, streams), illustrator: illustratorRole(config) };
}
