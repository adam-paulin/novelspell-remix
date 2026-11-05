/// <reference types="astro/client" />

interface ImportMetaEnv {
	/** Origin of the Remix API (the backend Worker). Defaults to the hosted API. */
	readonly PUBLIC_API_URL?: string;
}
interface ImportMeta {
	readonly env: ImportMetaEnv;
}
