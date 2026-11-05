// The prepared pictures (src/data/pictures.json): per key, the <source>s and fallback <img> of one pre-compressed folder under
// public/__assets/pictures/. The folders and the manifest are prepared ahead of the build by a separate image pipeline, so the
// site itself never encodes an image.
import pictures from "../data/pictures.json";

export interface PictureSource { media?: string; type: string; srcset: string }
export interface Picture { src: string; sources: PictureSource[]; img: { src: string; width: number; height: number } }

const all = pictures as Record<string, Picture>;

/** The prepared picture named `key`; the build fails on a key the manifest lacks. */
export function picture(key: string): Picture {
	const found = all[key];
	if (!found) throw new Error(`No prepared picture "${key}" in src/data/pictures.json`);
	return found;
}

/** The fallback file of `key` (JPEG, or PNG for transparency): the one URL a script sets, a download or a plain <img> uses. */
export const pictureFile = (key: string): string => picture(key).img.src;

export interface PicturePreload { type: string; srcset: string; media: string }

/**
 * Head preloads that fetch `key` from the HTML, only on viewports at least `min` wide (a CSS length, e.g. "64rem"), while its <img>
 * stays lazy everywhere. A lazy image starts only after the stylesheet and layout; a preload starts as the head is parsed.
 * There is one link per AVIF <source> the browser can pick in that range: each <source> answers the viewports from the previous
 * source's max-width (exclusive) to its own (inclusive), so every preload names the exact file the <picture> will use (no double fetch).
 */
export function picturePreloads(key: string, min: string): PicturePreload[] {
	const minPx = parseFloat(min) * (min.endsWith("rem") ? 16 : 1);
	const out: PicturePreload[] = [];
	let lo: number | null = null;
	for (const source of picture(key).sources) {
		const hi = source.media ? Number(source.media.match(/max-width:\s*(\d+)px/)?.[1]) : null;
		if (hi === null || hi >= minPx) {
			const parts = [lo !== null && lo >= minPx ? `(width > ${lo}px)` : `(width >= ${min})`];
			if (hi !== null) parts.push(`(width <= ${hi}px)`);
			out.push({ type: source.type, srcset: source.srcset, media: parts.join(" and ") });
		}
		if (hi !== null) lo = hi;
	}
	return out;
}
