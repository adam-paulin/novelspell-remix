// The fork design's book data (data/forks.json, src/books.ts): every turning point of every library book must cut its source
// chapter, or a remix of that what-if fails with fork_missing before the writer is called. Read from the real shipped data.
import { describe, expect, it } from "vitest";
import { bookMap, forkChapter, forkPoint, libraryBooks } from "../src/books";

const points = libraryBooks().flatMap(book => (bookMap(book.slug).divergencePoints ?? []).map(point => ({ slug: book.slug, point })));

describe("forks", () => {
	it("cover at least one turning point per library book", () => {
		const books = new Set(points.map(({ slug }) => slug));
		expect([...books].sort()).toEqual(libraryBooks().map(book => book.slug).sort());
	});

	it.each(points.map(({ slug, point }) => [`${slug} ${point.id}`, slug, point] as const))("%s cuts its chapter into text before and after the fork", (_name, slug, point) => {
		const chapter = forkChapter(slug, point);
		expect(chapter.title).toMatch(/\S/);
		expect(chapter.beforeFork).toMatch(/\S/);
		expect(chapter.afterFork).toMatch(/\S/);
	});

	it("picks the reader's chosen turning point, and a deterministic one for a custom what-if", () => {
		const { slug, point } = points[0]!;
		const map = bookMap(slug);
		expect(forkPoint(map, point.id, "anything")).toBe(point);
		const custom = "What if the letter never arrived?";
		expect(forkPoint(map, null, custom)).toBe(forkPoint(map, null, custom));
		expect(forkPoint(map, null, custom)).not.toBeNull();
	});
});
