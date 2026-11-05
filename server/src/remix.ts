// The remix pipeline: one POST runs one action start to finish inside the request and streams everything the page needs as events
// (frames.ts). Nothing is stored server side: the finished version leaves as a signed token (versionToken.ts) that the visitor's
// browser keeps and sends back to revise or redraw.
//   create  the cover starts at once (from the request and the book), the writer streams the chapter, the comic starts the moment the
//           answer's `events` close (earlyImages.ts), and the final chapter claims that comic (drawn again only when its prompt changed).
//   revise  the same with { previous, instruction } from the token; the browser keeps its cover.
//   redraw  draws the comic of the token's version again (after a failed comic), and the cover too when asked.
// A provider's 401/402/403 on any call (credits gone, auth, forbidden), or its spend cap's 402, stops the action: nothing more launches
// and the end event names the provider; a Meta stop also says showcase (Fast mode's Baseten stop does not: normal mode still works).
// Fast mode (the request's fast: true, on create and revise) and the thinking dial (thinking: low | medium | high) change only the
// writer: its model and its effort (config.ts WRITERS).
import { RoleError, asFailure, errorMessage, isFatal, isProviderStop, type Failure } from "./errors";
import { ILLUSTRATOR_MODEL, PROVIDERS, WRITERS } from "./config";
import { DEFAULT_THINKING, type ProviderId, type Thinking } from "./prompts";
import { createRoles } from "./roles";
import { bookMap, castIn, forkChapter, forkPoint, libraryBooks, type BookMap, type LibraryBook } from "./books";
import { PROMPTS, imagePrompt } from "./prompts";
import { EarlyImages } from "./earlyImages";
import { signPicture, signVersion, type VersionPayload } from "./versionToken";
import type { DrawnImage, ImageJob, Illustration } from "./metaClient";
import type { Env, KeepAlive } from "./config";
import type { EndError, StreamEvent } from "./frames";
import type { PresetTally } from "./presetRuns";

/** The hackathon has no login: every visitor is this username, and it is the author line on the forked book's cover. */
export const COVER_AUTHOR = "forkwright";

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The events of a chapter, whatever its age (`summary` and `panels[].beat` are older names): non-blank strings only. */
export const eventList = (chapter: { events?: unknown; summary?: unknown; panels?: unknown } | null | undefined): string[] =>
	((Array.isArray(chapter?.events) ? chapter.events : Array.isArray(chapter?.summary) ? chapter.summary : Array.isArray(chapter?.panels) ? chapter.panels.map((panel: { beat?: unknown } | null) => panel?.beat) : []) as unknown[]).filter(text);

/** The chapter as the page shows it: the writer's answer plus display data. */
export interface ChapterView {
	title: string;
	events: string[];
	chapter: string;
	castInScene: string[];
	panels: { beat: string }[];
}

// The pipeline accepts what the writer contract accepts and rejects only what breaks it (no prose, no events). A missing title becomes
// the book's; a cast list, if an answer has one, is filtered to the map's cast keys.
function assertChapter(asset: Record<string, unknown> | null | undefined, map: BookMap, fallbackTitle: string): ChapterView {
	const events = eventList(asset);
	if (!asset || !text(asset.chapter) || !events.length) throw new RoleError("chapter_invalid", "The writer returned a chapter without chapter text or its events.");
	const known = new Set((map?.cast ?? []).map(member => member.key));
	const cast = (Array.isArray(asset.castInScene) ? asset.castInScene : []).filter((key: unknown): key is string => typeof key === "string" && (!known.size || known.has(key))).slice(0, 10);
	return { title: text(asset.title) ? asset.title.trim() : String(map?.title ?? fallbackTitle ?? "Untitled"), events, chapter: asset.chapter, castInScene: cast, panels: events.map(beat => ({ beat })) };
}

/** The classic a remix leaves: its library entry first, the map as fallback. */
function originalOf(book: string, map: BookMap): { title: string; author: string } {
	const entry: Partial<LibraryBook> = libraryBooks().find(item => item.slug === book) ?? {};
	return { title: String(entry.title ?? map.title ?? "").trim(), author: String(entry.author ?? map.author ?? "").trim() };
}

/**
 * The comic job for a list of events (prompts/interfaces/comic.ts): the classic, the what-if, the six events and the people they name
 * (castIn). Deterministic, so the early comic and the final chapter's comic agree byte for byte.
 */
const comicJob = (map: BookMap, original: { title: string; author: string }, request: string, events: string[]): ImageJob => ({
	id: "comic",
	...imagePrompt(PROMPTS.comic, { data: { original, change: request, events, cast: castIn(map, events.join(" ")).map(member => ({ name: member.name, ...(typeof member.role === "string" ? { role: member.role } : {}) })) } }),
});

type Owner = { book: string; request: string };

// An image event carries its raw bytes (sent as its frame's body) and `sig`, this service's signature of the bytes for this slot of
// this remix (its book and what-if), so the picture can later go into that remix's shared link and nowhere else (shares.ts).
const imageLine = async (env: Env, owner: Owner, image: DrawnImage): Promise<StreamEvent> => ({ t: "image", id: image.id, mime: image.mime, ...(image.width ? { width: image.width, height: image.height } : {}), sig: await signPicture(env, image.bytes, { slot: image.id, book: owner.book, request: owner.request }), bytes: image.bytes });

export type Action =
	| { kind: "create"; input: { book: string; request: string; divergenceId: string | null; fast?: boolean; thinking?: Thinking } }
	| { kind: "revise"; input: { version: VersionPayload; instruction: string; fast?: boolean; thinking?: Thinking } }
	| { kind: "redraw"; input: { version: VersionPayload; cover: boolean } };

/** The end message of a provider stop: its spend cap, or its refusal of our key. */
const stopMessage = (provider: string, outcome: string, status: number | undefined) => {
	const name = PROVIDERS[provider as ProviderId]?.name ?? provider;
	return outcome === "spend_cap_reached" ? `The app's ${name} budget is spent.` : `${name} refused our key (${status}).`;
};

export type Emit = (event: StreamEvent) => Promise<void>;

/**
 * Runs one action and writes its events with emit(event) (awaited: backpressure). Never throws: every failure ends in an `end` event.
 *   tally    a preset run's call counter, or null
 *   closed() true once the client went away (nothing more is launched)
 */
export async function runRemix(env: Env, action: Action & { tally: PresetTally | null; keepAlive?: KeepAlive | null; emit: Emit; closed?: () => boolean }): Promise<void> {
	const { kind, emit, closed = () => false } = action;
	const base: Owner & { divergenceId: string | null } & Partial<VersionPayload> = action.kind === "create" ? action.input : action.input.version;
	const book = base.book;
	const n = action.kind === "revise" ? action.input.version.n + 1 : action.kind === "redraw" ? action.input.version.n : 1;
	let stop = null as Failure | null; // the action's provider stop, once seen
	const noteStop = (error: unknown) => {
		if (stop || !isFatal(error)) return;
		const failure = asFailure(error)!;
		stop = isProviderStop(failure) ? failure : failure.attempts?.find(isProviderStop) ?? null;
	};
	const halted = (): Failure | null => stop ?? (closed() ? new RoleError("stopped", "The visitor left.") : null);
	let chapterSent = false;
	const finish = (error: unknown, stage: EndError["stage"]) => {
		if (!error) return emit({ t: "end", status: "ready" });
		const reason: unknown = stop ?? error;
		console.error(`[remix ${kind}] ${stage}`, asFailure(error)?.message ?? error);
		const code = asFailure(reason)?.code ?? "failed";
		// The provider that stopped the action: its stop, or a provider with no key on this Worker (<provider>_unconfigured, nothing sent).
		const unconfigured = /^(\w+)_unconfigured$/.exec(code)?.[1];
		const provider = (stop?.provider ?? (unconfigured && unconfigured in PROVIDERS ? unconfigured : null)) as ProviderId | null;
		return emit({ t: "end", status: "error", error: { code, message: String(asFailure(reason)?.message ?? reason).slice(0, 600), stage, ...(provider ? { provider } : {}), ...(stop?.provider === "meta" ? { showcase: true as const } : {}) } });
	};
	try {
		const map = bookMap(book);
		const original = originalOf(book, map);
		const comicFor = (events: string[]) => comicJob(map, original, base.request, events);
		const roles = createRoles(env, action.tally, action.keepAlive ?? null);
		const deadline = Date.now() + roles.config.stageBudgetMs;
		const trace = { remixId: crypto.randomUUID(), version: n };
		const divergenceId = base.divergenceId || null;
		const writer = action.kind === "redraw" ? null : WRITERS[action.input.fast ? "fast" : "normal"][action.input.thinking ?? DEFAULT_THINKING];
		const models = { ...(writer ? { writer: { provider: writer.provider, model: writer.model, effort: writer.effort } } : {}), illustrator: { provider: ILLUSTRATOR_MODEL.provider, model: ILLUSTRATOR_MODEL.model } };
		await emit({ t: "accepted", version: n, divergenceId, models });

		const draw = async (jobs: ImageJob[]): Promise<Illustration> => {
			try { return await roles.illustrator.illustrate({ jobs, trace, deadline, stopped: () => Boolean(halted()), halted }); } catch (error) { noteStop(error); throw error; }
		};
		// The forked book's cover (prompts/interfaces/cover.ts): the classic, the what-if and the author line.
		const coverJob = async (): Promise<ImageJob> => ({ id: "cover", ...imagePrompt(PROMPTS.cover, { data: { original, change: base.request, author: COVER_AUTHOR } }) });
		const payload = (chapter: ChapterView): VersionPayload => ({ book, request: base.request, divergenceId, n, events: chapter.events, chapter: chapter.chapter, title: chapter.title });

		if (action.kind === "redraw") {
			const events = eventList(base);
			// Each picture goes to the page the moment it lands (a slow cover never holds back the comic); a stop seen on either ends the action as showcase.
			const land = (drawing: Promise<Illustration>) => drawing.then(async result => { for (const image of result.images) await emit(await imageLine(env, base, image)); });
			const [comic] = await Promise.allSettled([land(Promise.resolve().then(() => draw([comicFor(events)]))), action.input.cover ? land(coverJob().then(job => draw([job]))) : null]);
			if (comic.status === "rejected") return await finish(comic.reason, "images");
			return await finish(stop, "images");
		}

		// Pictures start while the writer writes: the cover (create) at once, the comic when the events close. A picture of a writer attempt
		// that was then abandoned is withdrawn (discard); the final chapter claims the comic whose prompt it produces.
		const sent = new Map<string, string>(); // id -> prompt of the picture the page shows
		// The early pictures' frames go out one after another, in order (signing the bytes takes a moment): a discard never overtakes the
		// picture it withdraws, and the action awaits `lane` before it reads `sent` or ends, so no picture frame is dropped after `end`. A step
		// that fails is logged and never rejects the lane; a picture whose frame could not be made (signing failed) is not sent and counts as failed.
		let lane: Promise<unknown> = Promise.resolve();
		const unsent = new Map<string, unknown>(); // prompt -> why its landed picture was not sent
		const inOrder = (step: () => Promise<unknown>) => (lane = lane.then(step).catch(error => console.error("[remix] picture lane", errorMessage(error))));
		const early = new EarlyImages({
			comic: comicFor, halted,
			illustrate: ({ jobs }) => draw(jobs),
			onLanded: (id, image, prompt) => { sent.set(id, prompt); return inOrder(() => imageLine(env, base, image).then(emit, error => { if (sent.get(id) === prompt) sent.delete(id); unsent.set(prompt, error); throw error; })); },
			onReset: () => inOrder(async () => { if (sent.has("comic")) { sent.delete("comic"); await emit({ t: "discard", id: "comic" }); } }),
		});
		if (action.kind === "create") {
			const job = await coverJob().catch(error => { console.error("[remix] cover prompt", errorMessage(error)); return null; }); // the cover is optional
			if (job) early.cover(job);
		}

		// The writer's stream: one follower per attempt reads its in-memory stream, which holds only what passed the answer's gate
		// (metaClient.ts writeCall): it hands the events to the early comic and sends the prose deltas to the page.
		let attempt = 0;
		let follower: { state: { stop: boolean; ended: boolean; dead: boolean }; done: Promise<void> } | null = null;
		const follow = (path: string) => {
			// dead: settle() gave up on this reader; nothing it still reads may reach the page or start a picture.
			const state = { stop: false, ended: false, dead: false };
			const done = (async () => {
				let offset = 0;
				while (!state.ended) {
					const last = state.stop;
					const lines = await roles.streams.read(path, offset, last ? 0 : 1000);
					if (lines?.length) {
						offset += lines.length;
						let prose = "";
						for (const message of lines) {
							if (state.dead) return;
							if (message.t === "d") prose += message.v;
							else if (message.t === "events") early.summary(message.events);
							else if (message.t === "end") state.ended = true;
						}
						if (prose && !state.dead) await emit({ t: "text", d: prose });
					}
					if (last) return;
					if (!lines?.length) await sleep(50); // the stream does not exist yet (or the long poll ran out): look again shortly
				}
			})();
			return { state, done };
		};
		const settle = async () => {
			if (!follower) return;
			follower.state.stop = true;
			await Promise.race([follower.done, sleep(1500)]);
			follower.state.dead = follower.state.ended = true;
			follower = null;
		};
		// The fork design (prompts writer / revise = core remix_chapter / remix_revise): INFO is the book and the chapter cut at the fork
		// (books.ts forkPoint + forkChapter, data/forks.json), DATA the reader's own input. A revise forks where its remix forked.
		const point = forkPoint(map, divergenceId, base.request);
		const writerInput = (): { info: Record<string, unknown>; data: Record<string, unknown> } => {
			if (!point) throw new RoleError("fork_missing", `${book} has no divergence points to fork at.`);
			return {
				info: { title: original.title, author: original.author, chapter: forkChapter(book, point) },
				data: action.kind === "revise"
					? { request: base.request, previous: { events: eventList(base), chapter: action.input.version.chapter }, instruction: action.input.instruction }
					: { request: base.request },
			};
		};
		let chapter: ChapterView;
		try {
			const written = await roles.writer.write({
				...writerInput(), trace, deadline, halted,
				mode: action.input.fast ? "fast" : "normal", thinking: action.input.thinking ?? DEFAULT_THINKING,
				onAttempt: async ({ stream }) => {
					await settle();
					early.newGeneration();
					await emit({ t: "start", attempt: ++attempt, streaming: Boolean(stream) });
					if (stream) follower = follow(stream);
				},
				onAttemptEnd: ({ outcome, status, provider }) => noteStop({ code: outcome, status, provider, message: stopMessage(provider, outcome, status) }),
			});
			await settle();
			chapter = assertChapter(written.asset as unknown as Record<string, unknown>, map, book);
		} catch (error) {
			noteStop(error);
			await settle();
			early.close();
			return await finish(error, "writing");
		}
		await emit({ t: "chapter", chapter });
		chapterSent = true;
		await emit({ t: "version", n, token: await signVersion(env, payload(chapter)) });

		// The comic for the final chapter: the early one when its prompt matches, else drawn now. An early comic that failed is not drawn
		// again automatically (Redraw is the explicit retry); a stop seen anywhere ends the action.
		const job = comicFor(chapter.events);
		const claimed = (await early.claim(job.prompt)?.promise) ?? null;
		const coverEntry = action.kind === "create" ? early.claim(early.coverPrompt) : null;
		await lane; // an early comic that just landed is out before its prompt is compared
		if (sent.has("comic") && sent.get("comic") !== job.prompt) { sent.delete("comic"); await emit({ t: "discard", id: "comic" }); }
		let failure: unknown = null;
		if (claimed?.ok && unsent.has(job.prompt)) failure = unsent.get(job.prompt);
		else if (claimed?.ok) {
			if (sent.get("comic") !== job.prompt) { sent.set("comic", job.prompt); await emit(await imageLine(env, base, claimed.image!)); }
		} else if (claimed) failure = claimed.error;
		else if (stop) failure = stop;
		else {
			try { for (const image of (await draw([job])).images) { sent.set(image.id, job.prompt); await emit(await imageLine(env, base, image)); } } catch (error) { failure = error; }
		}
		// The response stays open for the cover (usually landed long before): the page has no other way to receive it.
		if (coverEntry) await coverEntry.promise;
		await lane;
		early.close();
		return await finish(failure ?? stop, "images");
	} catch (error) {
		noteStop(error);
		return await finish(error, chapterSent ? "images" : "writing").catch(() => {});
	}
}
