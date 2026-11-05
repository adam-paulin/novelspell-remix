// The test suite (npm test): every test runs inside the Workers runtime (workerd, through Cloudflare's Vitest plugin) against the
// Worker in wrangler.jsonc, with a local D1 that has every migration applied. The model APIs are never reached: test/fakeMeta.ts
// answers their URLs in place of fetch, so the suite is offline and free.
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
	const migrations = await readD1Migrations("migrations");
	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						// Test-only secrets and endpoints: the fake answers these hosts, nothing real is configured.
						META_MODEL_API_KEY: "test-meta-key",
						BASETEN_API_KEY: "test-baseten-key",
						VERSION_SECRET: "test-only-version-secret-not-a-real-secret",
						META_BASE_URL: "https://meta.fake/v1",
						BASETEN_BASE_URL: "https://baseten.fake/v1",
						SITE_ORIGINS: "https://studio.test",
						// Retries back off for milliseconds, not seconds.
						RETRY_BASE_MS: "1",
						RETRY_MAX_MS: "5",
						// The per-client limits stay out of the way of the other tests; test/client-limits.test.ts sets its own.
						ACTION_DAILY_LIMIT: "",
					},
					ratelimits: { ACTION_LIMITER: { namespace_id: "41771", simple: { limit: 100_000, period: 60 } } },
				},
			}),
		],
		test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
	};
});
