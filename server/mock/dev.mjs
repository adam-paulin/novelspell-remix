#!/usr/bin/env node
// The free local mode: the whole NovelSpell Remix app on one localhost link, with every model call answered by the local stand-ins
// in this folder (meta/server.mjs serves remixes Meta's models already made; nothing calls a model, nothing costs anything).
//   npm run dev:mock   (in app/server, the Worker folder)   [-- --no-build] [-- --port 8787]
// Steps: build the site (the Worker folder's `npm run build:site`, skipped by --no-build when build/site exists), apply the local D1 migrations,
// start the Meta stand-in on 127.0.0.1 (port 8790, else any free one), then `wrangler dev --local` on 8787 (else the next free port)
// with MOCK=1, META_BASE_URL pointing at the stand-in and a dummy key. With MOCK=1 the Worker refuses any non-loopback META_BASE_URL.
// Ctrl-C (or SIGTERM) stops both. The stand-in's call log: GET http://127.0.0.1:<port>/__calls and build/mock-meta-calls.jsonl in the Worker folder.
// Stand-in knobs (env): FAKE_META_TIME_SCALE (1; 0 = instant), FAKE_META_FAULTS (e.g. "writer429=0.3,image503=0.2"), FAKE_META_CONTENT.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeMeta } from "./meta/server.mjs";
import { localHeaders } from "../local-headers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const WRANGLER = join(SERVER, "node_modules/.bin/wrangler");
const KEY = "free-local-mode-dummy-key"; // the stand-in accepts any key; this one is never a real credential
const VERSION_SECRET = "free-local-mode-version-secret-not-a-real-secret"; // signs local version tokens only
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };

const free = port => new Promise(done => { const probe = createServer().once("error", () => done(false)).listen(port, "127.0.0.1", () => probe.close(() => done(true))); });
async function firstFree(from) { for (let port = from; port < from + 50; port++) if (await free(port)) return port; throw new Error(`no free port from ${from}`); }
const run = (command, list, label) => {
	const result = spawnSync(command, list, { cwd: SERVER, stdio: ["ignore", "inherit", "inherit"], env: process.env });
	if (result.status !== 0) { console.error(`[mock] ${label} failed (${result.error?.message ?? `exit ${result.status}`}).`); process.exit(result.status || 1); }
};

if (!existsSync(WRANGLER)) { console.error(`[mock] ${WRANGLER} is missing: run npm install in ${SERVER} first.`); process.exit(1); }
if (flag("--no-build") && existsSync(join(SERVER, "build/site"))) console.log("[mock] --no-build: serving the existing build/site.");
else run("npm", ["run", "build:site"], "npm run build:site");
localHeaders(); // the local link is plain http (local-headers.mjs)
run(WRANGLER, ["d1", "migrations", "apply", "DB", "--local"], "the local D1 migrations");

mkdirSync(join(SERVER, "build"), { recursive: true });
const fake = await startFakeMeta({ port: (await free(8790)) ? 8790 : 0, logFile: join(SERVER, "build/mock-meta-calls.jsonl"), key: KEY });
const port = await firstFree(Number(option("--port") ?? 8787));
const url = `http://localhost:${port}`;
const worker = spawn(WRANGLER, [
	"dev", "--local", "--port", String(port), "--show-interactive-dev-session=false",
	"--var", "MOCK:1", "--var", `META_BASE_URL:${fake.base}`, "--var", `META_MODEL_API_KEY:${KEY}`, "--var", `VERSION_SECRET:${VERSION_SECRET}`,
], { cwd: SERVER, stdio: ["ignore", "inherit", "inherit"], detached: true, env: process.env });

let stopping = false;
async function stop(code = 0) {
	if (stopping) return;
	stopping = true;
	try { process.kill(-worker.pid, "SIGTERM"); } catch {}
	await fake.stop().catch(() => {});
	setTimeout(() => { try { process.kill(-worker.pid, "SIGKILL"); } catch {} process.exit(code); }, 1500).unref();
	worker.once("exit", () => process.exit(code));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("SIGHUP", () => stop(0));
worker.once("exit", code => { if (!stopping) { console.error(`[mock] wrangler dev exited (${code}).`); stop(code || 1); } });

// Ready when the Worker answers and says it is in mock mode.
for (let tries = 0; tries < 240 && !stopping; tries++) {
	try {
		const health = await (await fetch(`${url}/api/health`)).json();
		if (health.mock !== true) { console.error("[mock] the Worker is up but not in mock mode: stopping."); await stop(1); }
		console.log(`\n[mock] Free local mode ready (no model is ever called): ${url}\n[mock] Meta stand-in: ${fake.base} (calls: http://127.0.0.1:${fake.port}/__calls)\n[mock] Ctrl-C stops both.\n`);
		break;
	} catch { await new Promise(done => setTimeout(done, 500)); }
}
