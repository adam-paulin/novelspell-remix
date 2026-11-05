// The shapes the studio works with: a remix as IndexedDB keeps it (and as the compiled featured and shared remixes are read), the
// record the renderer paints, an action in flight, and the frames of an action's response (server/README.md, "The frame stream").

/** A picture: a Blob for the visitor's own remix, a plain URL for a compiled or shared one. */
export type Picture = Blob | string | null;

export interface Divergence { chapterId?: string; moment?: string; change?: string }
export interface Panel { beat?: string }
export interface Chapter {
	title?: string;
	chapter?: string;
	logline?: string;
	shareText?: string;
	panels?: Panel[];
	continuity?: unknown[];
	castInScene?: string[];
	divergence?: Divergence;
}
/** What the free demo served instead of what was typed (its own what-if, change, comic size). */
export interface Preview { request?: string; instruction?: string; panels?: number }
/** What the Worker already holds for a version's share link (the picture signatures sent). */
export interface SharedMark { api: string; id: string; cover: string | null; comic: string | null }
export interface Provenance { writer?: { model?: string }; illustrator?: { model?: string } }
/** The models an action uses, from its accepted line (writer absent on a redraw). */
export interface ActionModels { writer?: { provider?: string; model?: string; effort?: string | null }; illustrator?: { provider?: string; model?: string } }

export interface Version {
	n: number;
	instruction?: string;
	preview?: Preview;
	chapter: Chapter | null;
	token?: string | null;
	comic: Picture;
	comicSig?: string | null;
	shared?: SharedMark;
	/** The models that made this version (its create or revise accepted line): the credit line names them. */
	provenance?: Provenance;
}
// Store `remixes` (keyPath id, a client-made UUID), one record per remix, written whole as each piece lands. Versions are oldest
// first; the last is the current one. *Sig: the Worker's signature of that picture (its image event), which a share needs.
export interface Remix {
	id: string;
	book: string;
	request: string;
	divergenceId: string | null;
	createdAt?: number;
	updatedAt?: number;
	cover: Picture;
	coverSig?: string | null;
	versions: Version[];
	featured?: boolean;
	shared?: boolean;
	shareId?: string;
	provenance?: Provenance;
}

export type Status = "writing" | "illustrating" | "ready" | "error";
/** provider: the writer provider that refused our key or is out of budget (with showcase for Meta; alone for Baseten, Fast mode). */
export interface RemixError { code?: string; stage?: string; revision?: boolean; showcase?: boolean; network?: boolean; provider?: string }

/** A remix as the renderer paints it (the shown version; partial while a create is starting). */
export interface ViewRecord {
	id?: string;
	book?: string;
	request?: string;
	divergenceId?: string | null;
	featured?: boolean;
	shared?: boolean;
	provenance?: Provenance;
	versions?: Version[];
	version?: number;
	latest?: number;
	instruction?: string;
	asked?: string;
	preview?: Preview;
	chapter?: Chapter | null;
	images?: { comic?: string | null; cover?: string | null; share?: string | null };
	viewing?: boolean;
	status?: Status;
	error?: RemixError | null;
}

export interface AcceptedLine { t: "accepted"; version: number; preview?: Preview; divergenceId?: string; models?: ActionModels }
/** One event of an action's framed response; an image carries its raw bytes as the received slices (`parts`). */
export type Line =
	| AcceptedLine
	| { t: "start" }
	| { t: "text"; d: string }
	| { t: "image"; id: string; mime: string; sig?: string; parts: Uint8Array[] }
	| { t: "discard" }
	| { t: "chapter"; chapter: Chapter }
	| { t: "version"; n?: number; token: string }
	| { t: "end"; status: string; error?: RemixError };

export interface RunBody { book?: string; request?: string; divergenceId?: string; instruction?: string; token?: string; cover?: boolean; fast?: boolean; thinking?: "low" | "medium" | "high" }
/** An action in flight: record is null until a create is accepted, entry is the version being made, committed once its token landed. */
export interface Run {
	op: number;
	kind: "create" | "revise" | "redraw";
	body: RunBody;
	record: Remix | null;
	entry: Version | null;
	committed: boolean;
	accepted?: AcceptedLine;
	text?: string;
}
