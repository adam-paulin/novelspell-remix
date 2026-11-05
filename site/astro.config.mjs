// The site is a static build: every page is a file made at build time and served untouched (no server rendering).
// CSS goes through Tailwind v4 and Lightning CSS with fixed browser targets (Safari 16.4, Firefox 128, Chrome 111), so the shipped
// stylesheet keeps its exact meaning; the browser gets plain JavaScript and no UI framework.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { Features } from "lightningcss";
import { loadEnv } from "vite";

const origin = "https://novelspell-remix.apptory.workers.dev";

const targets = { safari: (16 << 16) | (4 << 8), ios_saf: (16 << 16) | (4 << 8), firefox: 128 << 16, chrome: 111 << 16 };

const cssName = (asset) => (asset.names?.[0]?.endsWith(".css") ? "assets/styles.[hash][extname]" : "assets/[name].[hash][extname]");

// The API origin the page calls, resolved as src/config.ts does: PUBLIC_API_URL unset means the hosted API, empty means same origin.
const api = loadEnv("production", fileURLToPath(new URL(".", import.meta.url)), "PUBLIC_").PUBLIC_API_URL ?? origin;
const apiOrigin = api ? new URL(api).origin : "";

// public/_headers allows connect-src 'self' only; a build whose API sits on another origin adds that origin to the built copy.
const cspApi = {
	name: "csp-api-origin",
	hooks: {
		"astro:build:done": async ({ dir }) => {
			if (!apiOrigin) return;
			const file = new URL("_headers", dir);
			const text = await readFile(file, "utf8");
			if (!text.includes("connect-src 'self';")) throw new Error("public/_headers: the CSP has no \"connect-src 'self';\" to extend");
			await writeFile(file, text.replace("connect-src 'self';", `connect-src 'self' ${apiOrigin};`));
		},
	},
};

export default defineConfig({
	site: origin,
	output: "static",
	trailingSlash: "ignore",
	compressHTML: true,
	devToolbar: { enabled: false },
	build: { format: "directory", assets: "assets", inlineStylesheets: "never" },
	integrations: [cspApi],
	vite: {
		plugins: [tailwindcss()],
		css: {
			transformer: "lightningcss",
			lightningcss: { targets, exclude: Features.LogicalProperties | Features.DirSelector | Features.LightDark },
		},
		// Readable asset names: the one stylesheet (emitted by the page build) and the browser script (the client build's only entry).
		build: { cssMinify: "lightningcss", rolldownOptions: { output: { assetFileNames: cssName } } },
		environments: { client: { build: { rolldownOptions: { output: { entryFileNames: "assets/main.[hash].js", assetFileNames: cssName } } } } },
	},
});
