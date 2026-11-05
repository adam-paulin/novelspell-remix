// Early pictures. The writer's answer opens with its `events`, so while the model is still writing prose the service already has
// everything the comic page needs: the pipeline calls summary() the moment `events` closes and the comic starts in parallel with the
// prose. The forked book's cover does not wait for the writer at all: it starts at create (cover()). When the chapter lands, claim()
// hands back the picture whose prompt equals the one the final chapter produces, so nothing is drawn twice.
//
// Attempts: a writer retry starts a new `generation` (newGeneration()). Pictures of an older generation are never shown, but they stay
// claimable by prompt (identical events in the next attempt reuse them).
import { isFatal } from "./errors";
import type { DrawnImage, Illustration, ImageJob } from "./metaClient";

export interface EarlyResult {
	ok: boolean;
	id: string;
	image?: DrawnImage;
	error?: unknown;
	fatal?: boolean;
	rendered: Illustration | null;
	startedAt: number;
	readyAt: number;
}

export interface EarlyEntry {
	id: string;
	generation: number;
	startedAt: number;
	promise: Promise<EarlyResult>;
	result: EarlyResult | null;
	sticky: boolean;
}

export interface EarlyImagesOptions {
	/** The comic job for a list of events (remix.ts): deterministic, so claim() can match it to the final chapter's. Throws when the events do not fit the comic prompt. */
	comic: (events: string[]) => ImageJob;
	/** Draws these jobs (the illustrator role). */
	illustrate: (input: { jobs: ImageJob[]; stopped: () => boolean }) => Promise<Illustration>;
	/** A picture of the current generation (or the cover) is ready: send it to the page now. */
	onLanded: (id: string, image: DrawnImage, prompt: string, rendered: Illustration) => unknown;
	/** A new attempt began after a picture of the previous one was shown: the page withdraws it. */
	onReset: () => unknown;
	/** An Error once the action was stopped (a Meta stop anywhere, or the visitor left): nothing more launches. */
	halted: () => unknown;
}

export class EarlyImages {
	private readonly options: EarlyImagesOptions;
	private shown = false; // the page shows a picture of the current generation
	private generation = 0;
	private readonly launched = new Map<string, EarlyEntry>(); // prompt -> entry
	private closed = false;
	private fatal: unknown = null; // a stop signal from an early picture: nothing more launches
	coverPrompt: string | undefined;

	constructor(options: EarlyImagesOptions) {
		this.options = options;
	}

	newGeneration(): void {
		this.generation += 1;
		if (this.shown) { this.shown = false; this.options.onReset(); }
	}

	/** The events passed the answer's gate (answerStream.ts): the comic page (one panel per event) starts. */
	summary(events: string[]): void {
		if (this.closed) return;
		let job: ImageJob;
		try { job = this.options.comic(events); } catch { return; } // a comic prompt that cannot render: the chapter still lands, without its early comic
		this.launch("comic", job.prompt, job.aspect_ratio);
	}

	/**
	 * The forked book's cover (create only), fired the moment the create arrives, in parallel with the writer. It belongs to the remix,
	 * not to a writer attempt: a retry never resets or discards it, so it lands whenever it is ready and stays.
	 */
	cover({ prompt, aspect_ratio }: { prompt: string; aspect_ratio: string }): EarlyEntry | undefined {
		this.launch("cover", prompt, aspect_ratio, true);
		this.coverPrompt = prompt;
		return this.launched.get(prompt);
	}

	private launch(id: string, prompt: string, aspect_ratio: string, sticky = false): void {
		// After closure or a stop nothing may start (every launch is billed).
		if (this.closed || this.fatal || this.launched.has(prompt) || this.options.halted()) return;
		const generation = this.generation;
		const startedAt = Date.now();
		const promise = (async (): Promise<EarlyResult> => {
			let rendered: Illustration | null = null;
			try {
				rendered = await this.options.illustrate({ jobs: [{ id, prompt, aspect_ratio }], stopped: () => this.closed || Boolean(this.fatal) });
				const image = rendered.images.find(item => item.id === id);
				if (!image) throw new Error(`no ${id} image`);
				if (this.closed && !sticky) throw new Error("closed"); // the cover outlives the writing: it lands whenever it is ready
				// Not awaited: landing never delays the action; a landing failure is logged and the picture stays claimable.
				const landed = (pending: unknown) => Promise.resolve(pending).catch(failure => console.error(`[early ${id}] landing`, failure?.message ?? failure));
				const done = rendered;
				if (sticky) landed(this.options.onLanded(id, image, prompt, done));
				else if (!this.closed && generation === this.generation) { this.shown = true; landed(this.options.onLanded(id, image, prompt, done)); }
				return { ok: true, id, image, rendered, startedAt, readyAt: Date.now() };
			} catch (error) {
				const fatal = isFatal(error);
				if (fatal && !this.fatal) this.fatal = error;
				return { ok: false, id, error, fatal, rendered, startedAt, readyAt: Date.now() };
			}
		})();
		const entry: EarlyEntry = { id, generation, startedAt, promise, result: null, sticky };
		promise.then(result => { entry.result = result; });
		this.launched.set(prompt, entry);
	}

	/** The early picture for exactly this prompt, if one was started. */
	claim(prompt: string | undefined): EarlyEntry | null {
		return prompt === undefined ? null : this.launched.get(prompt) ?? null;
	}

	/** Nothing more may reach the page (the writing failed, or the final chapter took over). */
	close(): void {
		this.closed = true;
	}
}
