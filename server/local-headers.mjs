#!/usr/bin/env node
// Local serving is plain http: drop the two https-only headers from the local copy of the built site's _headers (HSTS and the CSP's
// upgrade-insecure-requests). Kept, they make WebKit (Safari) upgrade every sub-resource to https://localhost, which fails, so the
// page loads with no styles, scripts, fonts or images. A deploy rebuilds build/site from the site's own _headers, so it keeps both.
// Run by `npm run dev` (node local-headers.mjs) and by the free mode (mock/dev.mjs imports it).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HEADERS = join(dirname(fileURLToPath(import.meta.url)), "build/site/_headers");

export function localHeaders(path = HEADERS) {
	if (!existsSync(path)) return;
	const text = readFileSync(path, "utf8");
	writeFileSync(path, text.split("\n").filter(line => !/^\s*Strict-Transport-Security:/i.test(line)).map(line => line.replace(/;\s*upgrade-insecure-requests\b/i, "")).join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) localHeaders();
