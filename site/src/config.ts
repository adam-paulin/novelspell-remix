// Build-time settings of the site.
export const site = {
	origin: "https://novelspell-remix.apptory.workers.dev",
	/** The Remix API origin the page calls (`/api/*` is appended). Set PUBLIC_API_URL at build time to use another backend. */
	api: import.meta.env.PUBLIC_API_URL ?? "https://novelspell-remix.apptory.workers.dev",
	locale: "en-US",
} as const;
