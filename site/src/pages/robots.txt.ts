// robots.txt, generated from the site origin (src/config.ts): every page may be crawled; the sitemap lists them.
import type { APIRoute } from "astro";
import { site } from "../config";

export const GET: APIRoute = () => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
