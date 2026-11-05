// Runs before every test file: applies the D1 migrations to that file's local database (each file gets its own storage).
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
