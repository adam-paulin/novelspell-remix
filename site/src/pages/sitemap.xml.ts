// sitemap.xml, generated from the site origin (src/config.ts): the indexable pages (the 404 is noindex and not listed).
// lastmod: a legal page's own effective date (its "Effective date:" block), the build date for the studio.
import type { APIRoute } from "astro";
import { site } from "../config";
import { legal, type LegalDocument } from "../content/legal";

const built = new Date().toISOString().slice(0, 10);

function effective(doc: LegalDocument): string {
	for (const block of doc.blocks) {
		if (!("p" in block) || !Array.isArray(block.p)) continue;
		const at = block.p.findIndex((run) => typeof run === "object" && run.strong.startsWith("Effective date"));
		const date = at >= 0 ? String(block.p[at + 1] ?? "").trim() : "";
		if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
	}
	throw new Error(`${doc.title}: no "Effective date:" block for the sitemap lastmod`);
}

const pages = [
	{ path: "/", lastmod: built },
	{ path: "/terms/", lastmod: effective(legal.terms) },
	{ path: "/privacy/", lastmod: effective(legal.privacy) },
];

export const GET: APIRoute = () => {
	const urls = pages.map(({ path, lastmod }) => `\t<url>\n\t\t<loc>${new URL(path, site.origin).href}</loc>\n\t\t<lastmod>${lastmod}</lastmod>\n\t</url>`).join("\n");
	return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
