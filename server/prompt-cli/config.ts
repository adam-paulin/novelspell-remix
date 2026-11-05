// The CLI's settings: whether anything is sent, where, and how patiently. The models are set by role in src/prompts/models.ts (shared
// with the Worker).
import { META_API_URL } from "../src/prompts/index.js";

export const config = {
	/**
	 * true: build every request and write it to disk, send nothing (the default: free, and the way to check prompts).
	 * false: also send each request to the API and keep the answers. --send sets it to false for one run.
	 */
	payloadOnly: true,
	api: {
		baseUrl: process.env.META_BASE_URL ?? META_API_URL,
		/** The environment variable holding the key. It is read only when sending and never written anywhere. */
		keyEnv: "META_MODEL_API_KEY",
	},
	/** How many requests may be in flight at once when sending. */
	concurrency: 4,
	/** The longest one sent call may take, answer included (a chapter takes about 1-3 minutes). */
	timeoutMs: 600_000,
};
