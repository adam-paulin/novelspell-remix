// The book data, bundled into the Worker (data/books.json): the library index, every book map, and of the chapter texts only the
// chapters the divergence points name. Every lookup is an in-memory read: no fetch, no binding.
import DATA from "../data/books.json";
import FORKS from "../data/forks.json";
import { RoleError } from "./errors";

/** One library entry (the page's book list). */
export interface LibraryBook {
	slug: string;
	title: string;
	author: string;
	genre?: string;
	subgenres?: string[];
	hook?: string;
	logline?: string;
	premise?: string;
	chapters?: number;
	words?: number;
}

export interface CastMember {
	key: string;
	name: string;
	aliases?: string[];
	age?: string;
	appearance?: string;
	[field: string]: unknown;
}

/** A turning point a visitor can pick: `whatIf` is its preset request. */
export interface DivergencePoint {
	id: string;
	chapterId: string;
	label?: string;
	moment?: string;
	whatIf?: string;
	[field: string]: unknown;
}

/** A book map: everything the writer is told about the book. It is sent to the writer whole, as JSON. */
export interface BookMap {
	slug?: string;
	title?: string;
	author?: string;
	cast?: CastMember[];
	divergencePoints?: DivergencePoint[];
	visual?: { comicStyle?: string; era?: string; palette?: string; [field: string]: unknown };
	[field: string]: unknown;
}

/** The canonical chapter at a divergence point. */
export interface SourceChapter {
	id: string;
	title: string;
	text: string;
}

/** Where each divergence point forks (data/forks.json): its chapter is cut right after `after`, which occurs there exactly once. */
export interface ForkData {
	note: string;
	forks: Record<string, Record<string, { chapterId: string; after: string; continued?: string }>>;
}

/** The writer's and the reviser's INFO.chapter: the chapter cut at the fork. */
export interface ForkChapter {
	title: string;
	beforeFork: string;
	afterFork: string;
}

export interface BookData {
	books: LibraryBook[];
	maps: Record<string, BookMap>;
	sources: Record<string, Record<string, SourceChapter>>;
}

const BOOKS = DATA.books;
const SLUGS = new Set(BOOKS.map(book => book.slug));

export const isLibraryBook = (slug: unknown): slug is string => SLUGS.has(slug as string);

export const libraryBooks = (): LibraryBook[] => BOOKS;

export function bookMap(slug: string): BookMap {
	const map = Object.hasOwn(DATA.maps, slug) ? DATA.maps[slug] : null;
	if (!map) throw new RoleError("map_missing", `No book map for ${slug} yet.`);
	return map;
}

const STOP = new Set("a an the and or but of in on at to from with by for into what if his her their its him them he she they it is was were be not no instead".split(" "));
const terms = (text: unknown) => new Set((String(text ?? "").toLowerCase().match(/[a-z']+/g) ?? []).filter(word => word.length > 2 && !STOP.has(word)));

/**
 * The divergence point a remix forks at: the one it was started from, else (a custom what-if with no turning point) the point whose
 * what-if, moment and label share the most words with the request, ties to the earliest point. Deterministic, so a revise of the same
 * remix forks at the same place. Null only for a book with no divergence points.
 */
export function forkPoint(map: BookMap, divergenceId: string | null, request: string): DivergencePoint | null {
	const points = map?.divergencePoints ?? [];
	const chosen = divergenceId ? points.find(point => point.id === divergenceId) : undefined;
	if (chosen) return chosen;
	const wanted = terms(request);
	let best: DivergencePoint | null = null, bestScore = -1;
	for (const point of points) {
		const have = terms(`${point.whatIf ?? ""} ${point.moment ?? ""} ${point.label ?? ""}`);
		const score = [...wanted].filter(word => have.has(word)).length;
		if (score > bestScore) { best = point; bestScore = score; }
	}
	return best;
}

/** The chapter cut at a divergence point's fork (data/forks.json; a late fork's afterFork carries the following chapter text, `continued`), or a RoleError when the book data has no fork or text for it. */
export function forkChapter(slug: string, point: DivergencePoint): ForkChapter {
	const fork = FORKS.forks[slug]?.[point.id];
	const source = fork ? DATA.sources[slug]?.[fork.chapterId] : undefined;
	const at = fork && source ? source.text.indexOf(fork.after) : -1;
	if (!fork || !source || at < 0) throw new RoleError("fork_missing", `No fork for ${slug} ${point.id} (data/forks.json).`);
	const cut = at + fork.after.length;
	const afterFork = source.text.slice(cut).trim();
	return { title: source.title, beforeFork: source.text.slice(0, cut).trim(), afterFork: fork.continued ? `${afterFork}\n\n${fork.continued}` : afterFork };
}

// The comic's cast: the people its events name, picked deterministically (the early and the final comic prompts must agree byte for
// byte).
const TITLES = new Set(["mr", "mrs", "miss", "ms", "dr", "sir", "lady", "lord", "captain", "colonel", "admiral", "the", "of", "de", "van", "von", "old", "young", "uncle", "aunt", "professor", "reverend", "major", "general"]);
const words = (text: string) => String(text).match(/[A-Za-zÀ-ɏ']+/g) ?? [];

/** The cast members a text names (by full name, alias or a name word that belongs to no one else), in order of first mention, at most eight; the protagonist when it names nobody. */
export function castIn(map: BookMap, text: string): CastMember[] {
	const cast = map.cast ?? [];
	const owners = new Map<string, number>();
	const nameWords = (member: CastMember) => new Set([member.name, ...(member.aliases ?? [])].flatMap(words).filter(word => word.length > 2 && !TITLES.has(word.toLowerCase())));
	for (const member of cast) for (const word of nameWords(member)) owners.set(word, (owners.get(word) ?? 0) + 1);
	const where = (needle: string) => text.search(new RegExp(`(?<![A-Za-z\\u00C0-\\u024F])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z\\u00C0-\\u024F])`));
	const found: { member: CastMember; at: number }[] = [];
	for (const member of cast) {
		const needles = [member.name, ...(member.aliases ?? []), ...[...nameWords(member)].filter(word => owners.get(word) === 1)].filter(name => name.length > 2);
		const hits = needles.map(where).filter(at => at >= 0);
		if (hits.length) found.push({ member, at: Math.min(...hits) });
	}
	const named = found.sort((a, b) => a.at - b.at).map(item => item.member);
	return (named.length ? named : cast.slice(0, 1)).slice(0, 8);
}
