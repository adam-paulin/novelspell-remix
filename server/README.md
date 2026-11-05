# NovelSpell Remix API

The backend of NovelSpell Remix: pick a classic novel and a "what if", and it writes the chapter the author never wrote, with a comic page of its events and the cover of the alternate book. It is one Cloudflare Worker (TypeScript, [Hono](https://hono.dev)) with a D1 database, calling the [Meta Model API](https://api.meta.ai) for text (Muse Wonder 1.0) and pictures (Muse Image). In **Fast mode** (the reader's toggle) the chapter is written by Muse Spark Open, Meta's open-weights model, served by [Baseten](https://www.baseten.co); everything else is the same.

It is stateless: every action is one `POST` whose response streams the whole result as binary frames and then closes. The finished version leaves as a signed token that the visitor's browser keeps and sends back to revise or redraw. D1 holds only a spend ledger (one row per model provider), a write-only record of preset runs, and the remixes visitors choose to share.

## Setup

Requires Node.js 22.12+ and npm.

```sh
npm install
cp dev.vars.example .dev.vars      # then fill in the values
npm run db:migrate:local            # creates the local D1 tables (.wrangler/state)
npm run dev                         # wrangler dev --local, http://localhost:8787
curl http://localhost:8787/api/health
```

Other scripts: `npm test` (the test suite, below), `npm run typecheck` (strict `tsc --noEmit`: Worker, prompt CLI and tests), `npm run prompts` (the prompt payload CLI, below), `npm run dev:mock` (the app against a fake Meta API, `mock/`) and `npm run deploy` (builds `../site` into `build/site` and uploads it with the Worker: one Worker serves the site and the API). `.gitignore` keeps `node_modules/`, `.wrangler/` (local D1 state) and `.dev.vars` (your keys) out of commits.

### Deploying your own

1. `npx wrangler d1 create novelspell-remix` and put its id into `wrangler.jsonc` in place of NovelSpell's own.
2. `npx wrangler d1 migrations apply DB --remote` (every file in `migrations/`; run it again after pulling a new one)
3. `npx wrangler secret put META_MODEL_API_KEY` and `npx wrangler secret put VERSION_SECRET`, plus `npx wrangler secret put BASETEN_API_KEY` for Fast mode (without it Fast mode is refused with `baseten_unconfigured`; normal mode is unaffected)
4. `npm run deploy` (always this, never a bare `wrangler deploy`: it rebuilds `build/site`, which a local `npm run dev` leaves without the https-only headers). The site is served by the same Worker, so no origin needs configuring; set `SITE_ORIGINS` only if another site must call the API.

## Testing

```sh
npm test                            # vitest run: the whole suite, offline
npx vitest test/failures.test.ts    # one file, in watch mode
```

The suite uses [Vitest](https://vitest.dev) with Cloudflare's [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) (`@cloudflare/vitest-plugin`): every test runs inside the Workers runtime against the real Worker in `wrangler.jsonc`, with a local D1 database that has every migration applied. Nothing reaches a model: `test/fake-models.ts` answers the Meta and Baseten URLs in place of `fetch` (the Worker shares the tests' isolate), so the suite needs no keys, costs nothing and fails any test that tries to call another host. `vitest.config.ts` sets the test-only keys, URLs and a millisecond retry backoff.

| File | Covers |
| --- | --- |
| `test/answer-gate.test.ts` | The streaming gate (`src/answerStream.ts`): valid answers in any chunking, escapes and surrogate pairs across chunks, and every malformed opening failing at its first wrong character with no prose released |
| `test/retry-rule.test.ts` | The retry rule (`src/retryChain.ts`, `src/errors.ts`): how many retries, which failures wait first (429 / 5xx, `Retry-After`), the deadline, and the 401/402/403 stop |
| `test/create-flow.test.ts` | Create, revise and redraw end to end: the frame stream, the chapter and both pictures, what the writer reads (the fork as INFO, the reader's input as DATA), the thinking dial and Fast mode reaching the right model and effort |
| `test/forks.test.ts` | The shipped fork data: every turning point of every library book cuts its chapter (a missing one would fail that what-if with `fork_missing`) |
| `test/failures.test.ts` | Actions when the model APIs fail: retries that recover, bad answers never reaching the reader, retries running out, refusals and provider stops (Meta's showcase state, Baseten in Fast mode), a comic refused for content policy being retried |
| `test/client-limits.test.ts` | The per-client limits: a 429 before any model call, hashed client keys, each client counted on its own, failing open |
| `test/spend-cap.test.ts` | The per-provider spend ceilings: a reached cap sends no call, every call's cost is booked in `spend_ledger` |
| `test/shares.test.ts` | Shared links: publish, read back, add a picture later, refuse unsigned tokens and pictures |
| `test/api-edges.test.ts` | Health, request validation, origin rules, and the guards that keep a misconfigured Worker from sending anything |
| `test/fake-models.ts`, `test/api.ts`, `test/setup.ts` | The fake model APIs, the frame-stream client, the per-file D1 migration |

## Configuration

Secrets (`.dev.vars` locally, `wrangler secret put` deployed):

| Name | Meaning |
| --- | --- |
| `META_MODEL_API_KEY` | The Meta Model API key. Without it no call is sent (the action ends with `meta_unconfigured`). |
| `BASETEN_API_KEY` | The Baseten key for Fast mode's writer (Muse Spark Open, `meta-models/muse-spark-open-1026`). Without it a Fast-mode action ends with `baseten_unconfigured` (`provider: "baseten"`); normal mode never uses it. |
| `VERSION_SECRET` | 32+ characters; signs version tokens and picture signatures. Tokens only verify on a backend with the same secret. |

Vars (`wrangler.jsonc`; `.dev.vars` overrides them locally; all strings):

`wrangler.jsonc` ships NovelSpell's values for some of these (marked **shipped**); the default is what the code uses when a var is unset.

| Name | Default when unset | Meaning |
| --- | --- | --- |
| `META_BASE_URL` | `https://api.meta.ai/v1` (shipped) | The Meta API base. Point it at a local fake (`http://127.0.0.1:PORT/v1`) for free runs. |
| `BASETEN_BASE_URL` | `https://inference.baseten.co/v1` | The Baseten API base (Fast mode). In the free local mode (`MOCK=1`) every provider is answered by the fake at `META_BASE_URL`. |
| `SITE_ORIGINS` | none (the site is same-origin) | Comma-separated browser origins allowed by CORS and allowed to start work. |
| `META_SPEND_CAP_USD` | none (**shipped**: `130`) | The Meta Model API's spend ceiling at list price (writer and pictures); unset or `""` = no ceiling. With a ceiling every call reserves its estimate in D1 first and fails closed without the database. |
| `BASETEN_SPEND_CAP_USD` | none (**shipped**: `95`) | Baseten's own spend ceiling (Fast mode's writer), the same way. The two budgets never mix. |
| `SHARE_STORE_CAP_MB` | `400` | What all shared pictures together may hold. |
| `ACTION_DAILY_LIMIT` | none (**shipped**: `60`) | Model actions (create, revise, redraw) one client may start per UTC day; unset or `""` = no daily limit. |
| `WRITER_TIMEOUT_MS` | `600000` | A writer call's whole time limit (Muse Wonder at max effort takes about 3.5 min a chapter). |
| `WRITER_FIRST_DELTA_MS` | `480000` | No answer text this long after the call started = `stalled` (the thinking dial's High reasons for minutes first: up to 285 s measured). |
| `WRITER_STALL_MS` | `30000` | No answer text this long between deltas = `stalled`. |
| `RETRIES` | `3` | How many more times any failed writer call is tried (every provider). |
| `IMAGE_RETRIES` | `8` | How many more times a failed picture call is tried (a refused comic often goes through on a later try; a refusal is never billed). |
| `ILLUSTRATOR_TIMEOUT_MS` | `600000` (**shipped**: `90000`) | A picture call's time limit (one more try). |
| `RETRY_BASE_MS`, `RETRY_MAX_MS` | `1000` (shipped), `30000` | Backoff before retrying a 429 or 5xx (Retry-After is honoured up to a minute). |
| `STAGE_BUDGET_MS` | `840000` (shipped) | The time budget of one action; no retry starts past it. |

Bindings: `DB` (D1) and `CF_VERSION_METADATA` (the version id reported by `/api/health`; `wrangler dev` reports a local one).

## API

| Method and path | Body / result |
| --- | --- |
| `POST /api/remix` | `{ book, request (3-2000 chars), divergenceId?, fast?, thinking? }` → the frame stream. `fast: true` = Fast mode (Muse Spark Open on Baseten writes, else Muse Wonder 1.0 on Meta); `thinking`: `"low"` \| `"medium"` (default) \| `"high"` sets the writer's effort (table below), anything else is 400 `bad_thinking`. The cover starts at once, the comic when the answer's `events` close. |
| `POST /api/remix/revise` | `{ instruction (3-1000 chars), token, fast?, thinking? }` → the stream, version n+1 (`fast` and `thinking` as above, chosen per revision). Never redraws the cover. |
| `POST /api/remix/redraw` | `{ token, cover? }` → the stream: the comic of that version drawn again (`cover: true` draws a cover too). |
| `POST /api/share` | multipart `{ token, cover?, comic?, coverSig?, comicSig? }` → `{ id }` |
| `GET /api/share/:id` | the shared snapshot `{ id, at, book, divergenceId, request, n, chapter, pictures }` |
| `GET /api/share-picture/:hash` | a shared picture's bytes (immutable) |
| `GET /api/health` | `{ ok, service, version, models: { writer: { normal, fast: { provider, model, efforts: { low, medium, high } } }, illustrator: { provider, model } }, mock: false, books, budgets: { meta?, baseten?: { capUsd, spentUsd } } }` (a budget per capped provider) |

The thinking dial (`src/prompts/models.ts` `THINKING`), the writer's effort per level:

| `thinking` | normal: `muse-wonder-1.0` (Meta) | `fast: true`: `meta-models/muse-spark-open-1026` (Baseten) |
|---|---|---|
| `low` | `medium` | `medium` |
| `medium` (default) | `xhigh` | `high` |
| `high` | `max` | `xhigh` |

Before a stream starts, a refusal is JSON `{ "error": { "code", "message" } }`: 400 `bad_body` (over 336 KB, room for any version token, or not a JSON object), `bad_book`, `bad_request`, `bad_instruction`, `bad_thinking`, `bad_token`; 403 `cross_origin`; 404 `no_route`; 429 `rate_limited` (too many actions this minute) or `daily_limit` (this client's `ACTION_DAILY_LIMIT` is used up), with `Retry-After`; 503 `unavailable` (a temporary failure, or `VERSION_SECRET` missing or under 32 characters: then every remix action is refused before anything is spent). Sharing adds 413 `too_large`, 400 `bad_picture`, 404 `not_found`, 507 `storage_full`.

**Origins.** CORS answers only `SITE_ORIGINS` origins (preflights cached for 2 hours). A `POST` that starts work must come from this origin, a `SITE_ORIGINS` origin, or a non-browser client (no `Origin` header and not `sec-fetch-site: cross-site`); anything else gets `403 cross_origin` before anything is generated or spent.

**Per-client limits** (`src/clientLimits.ts`). The spend caps bound the whole app; these keep one client (a script in a loop) from spending it all. A client is its IP address (`cf-connecting-ip`), kept only as a salted hash. Per minute: the `ACTION_LIMITER` rate-limit binding (`wrangler.jsonc` `ratelimits`, 8 per minute) counts every create, revise, redraw and share. Per day: `ACTION_DAILY_LIMIT` model actions, counted in D1 (`client_actions`, migration 0006). The per-minute limiter is approximate (Cloudflare counts per location and eventually, so a fast burst goes over it); the daily count is exact. Both fail open (an unanswered limiter or database lets the action through; the spend caps still fail closed).

### The frame stream

`200 application/octet-stream`, `cache-control: no-store, no-transform`. One frame per event:

```
[u32 header length][header: the event as UTF-8 JSON][u32 body length][body]      (lengths big-endian)
```

An image event's body is the raw image bytes; every other event has an empty body. Events, in order:

| Event header | Meaning |
| --- | --- |
| `{"t":"accepted","version":n,"divergenceId","models":{writer?:{provider,model,effort},illustrator:{provider,model}}}` | first, at once (`models` for the credit line; no `writer` on a redraw) |
| `{"t":"start","attempt":k,"streaming":true}` | a writer attempt began: clear the prose streamed so far |
| `{"t":"text","d":"..."}` | chapter prose appended |
| `{"t":"image","id":"cover"\|"comic","mime","width","height","sig"}` + bytes | a picture landed; `sig` lets it into this remix's shared link |
| `{"t":"discard","id":"comic"}` | a comic already sent belonged to an abandoned attempt or a changed prompt |
| `{"t":"chapter","chapter":{title,events,chapter,castInScene,panels}}` | the validated chapter (replaces the streamed prose) |
| `{"t":"version","n","token"}` | the signed version: keep it, send it back to revise or redraw |
| `{"t":"end","status":"ready"}` or `{"t":"end","status":"error","error":{code,message,stage,provider?,showcase?}}` | last. `stage:"images"` after a `version` = the chapter is kept, offer Redraw. `showcase:true` = Meta refused the key (401/402/403) or Meta's spend cap was reached (a Baseten stop says `provider:"baseten"`, no showcase). |

No `end` frame means the connection dropped. A client that disconnects stops the action: nothing more is launched.

## How an action runs

`src/remix.ts` is the pipeline. A create starts the cover at once and the writer (a streamed Responses API call). The writer reads the fork: INFO is the book's title, author and the source chapter cut at the turning point (`{ title, beforeFork, afterFork }`, `src/books.ts` `forkPoint` + `forkChapter` over `data/forks.json`; a free what-if forks at the closest turning point), and DATA is the reader's input alone (`{ request }`, or `{ request, previous, instruction }` for a revise). The book map feeds the turning points and the comic's cast. Its answer is exactly `{ "events": [six strings], "chapter": "..." }` with `events` first, and its opening is the gate (`src/answerStream.ts`): nothing reaches the page until the six events have closed and passed, then the comic starts (`src/earlyImages.ts`) and only the chapter's prose streams. An opening that goes wrong cuts the call and asks again at once: at the first wrong character for its shape (prose, another key first), when the events list closes for its contents (not 6 non-blank strings). Past the gate nothing else is checked: anything after the chapter is ignored. The final chapter reuses that early comic when its prompt is identical, otherwise draws it again. The response stays open until the cover has landed.

Retries (`src/metaClient.ts`), one rule for every call: a failed call is tried up to `RETRIES` (3) more times (a picture: `IMAGE_RETRIES`, 8), whatever went wrong (a wrong answer or a refusal, a cut, incomplete or stalled stream, a timeout, a network failure, an unusable picture, a 429 or 5xx). A 429 or 5xx waits first (backoff); anything else is retried at once. Never retried: any other 4xx, except a picture 400 whose message says `content_policy_violation` (Muse Image refusals are not deterministic and never billed, so they are retried like any failed call; any other picture 400 is final). The spend cap reserves every call before it is sent, and `STAGE_BUDGET_MS` ends the chain. A Meta 401/402/403 (or the spend cap's 402) stops the whole action and ends it with `showcase: true`; an HTTP error keeps that meaning even when its body arrives too slowly to read.

Pictures are JPEGs drawn with `reasoning_strength: "high"` (better comics and covers for about 16 s more per comic, at the same flat $0.01).

## Spend and records

- **Cost of a call.** A writer call costs its reported usage at list price. A picture costs $0.01 once Meta answered 2xx (even if the image then proves unusable) and $0 when no 2xx answer came (a timeout, an abort, an error status). When the billing is unknown (a writer timeout or a cut stream) the call's estimate stands.
- **Spend ceilings, one per provider.** Each provider (`config.ts` `PROVIDERS`: `meta`, `baseten`) has its own cap var and its own row in `spend_ledger`. With a cap set, every call first reserves its estimate (a writer call: request characters / 4 at the input price plus the typical output of its effort, `prompts/models.ts` `TYPICAL_OUTPUT_TOKENS`, at the output price; a picture: its flat price) in its provider's row with one atomic upsert (`INSERT ... ON CONFLICT DO UPDATE ... WHERE usd + estimate <= cap RETURNING`), and its actual cost is booked after. A refused reservation is a 402 `spend_cap_reached`. Without the database, or when the ledger is unreadable, nothing is sent (`spend_guard_unavailable`).
- **Stops.** A provider refusing our key (401/402/403), its spend cap, or its missing key ends the action, and the end error names it (`provider`). A Meta stop also says `showcase: true` (the page shows its examples); a Baseten stop does not (the page says Fast mode is unavailable, and normal mode still works).
- **The visitor leaving stops the writing.** Once the visitor leaves (the stream is cancelled) or a provider stop ends the action, the writer call in flight is cut within a second and nothing more is started; the cut call keeps its reserved estimate.
- **Nothing is lost when the response ends.** Every model call is kept alive with `waitUntil` until it is booked, so a call still in flight when the stream closes is still counted. The platform ends that extra time after about 30 s: a longer call is cut then, keeps its reserved estimate, and its preset run may not be recorded.
- **Preset runs.** A create of a preset what-if (`divergenceId` + its exact request) is recorded in `preset_runs` after the response closed (the page never waits): status, timings, calls, cost (estimates included even without a ceiling), words, and the chapter. The pictures of the first two ready runs per turning point go to `preset_pictures`; a picture over D1's 2 MB value limit is skipped on its own. The record is write-only: nothing reads it back.
- **Shares.** `POST /api/share` stores a version's chapter and its signed pictures (chunked into 1 MB parts, stored once per content hash, up to `SHARE_STORE_CAP_MB` in total); two uploads for the same share at the same moment both keep their picture.

## Prompts

Every word the models read lives in `src/prompts/`, one file per prompt in `interfaces/` (`writer`, `revise`, `cover`, `comic`; `_chapter.ts` holds their shared parts), each a `definePrompt({...})`: its text, the Zod shapes of its input, its output (`json(...)` for a text model, `image(...)` for a picture) and its model role. One core (`core/`) renders any prompt into the exact Meta request: a cached prefix (the task, plus the system text, quality, rules, the book map and the answer schema when the prompt has them) and a per-call suffix (the request data), then the text body (with `prompt_cache_key`) or the image body. The models by role (id, effort, reasoning strength) are in `models.ts`. The Worker and the CLI import only from `src/prompts/index.ts`, which checks every prompt at load; rendering is deterministic (the early comic is reused only on an identical prompt).

`npm run prompts -- prompt-cli/entries.json` builds the request of every entry with the same code and writes them to `build/prompt-runs/<time>/` without sending anything (`--list` lists the prompts; `--send` sends them with `META_MODEL_API_KEY`, `META_BASE_URL` overriding the API).

## Files

| Path | Role |
| --- | --- |
| `src/index.ts` | Routes, request validation, origin rules, the streamed response |
| `src/remix.ts` | The create / revise / redraw pipeline |
| `src/earlyImages.ts` | Pictures started while the writer is still writing, claimed by prompt |
| `src/answerStream.ts` | The writer answer's gate: checks its opening as it streams, then decodes the chapter's prose |
| `src/prompts/` | The four prompts (`interfaces/`), the render and request core (`core/`), the models by role |
| `prompt-cli/` | The payload CLI (`npm run prompts`) and its sample entries |
| `mock/` | The fake Meta API for `npm run dev:mock` |
| `test/`, `vitest.config.ts` | The test suite (`npm test`, above) |
| `local-headers.mjs` | Drops the https-only headers (HSTS, `upgrade-insecure-requests`) from the local build for plain-http `npm run dev` / `dev:mock` (Safari); deploys keep them |
| `src/metaClient.ts` | Meta writer and image calls, SSE reading, answer validation, retry classification, billing |
| `src/imageCheck.ts` | Structural PNG / JPEG / WebP completeness check |
| `src/roles.ts` | Writer and illustrator retry chains, in-memory writer streams |
| `src/retryChain.ts` | Backoff and retry loop |
| `src/errors.ts` | Error type and the stop rule |
| `src/spendCap.ts` | D1 spend ceiling (reserve, then book the actual cost) |
| `src/clientLimits.ts` | Per-client limits: the per-minute rate limiter and the daily count of model actions |
| `src/presetRuns.ts` | Write-only D1 record of preset what-if runs |
| `src/shares.ts` | Shared links (D1) |
| `src/versionToken.ts` | HMAC version tokens and picture signatures |
| `src/frames.ts` | Frame encoding and the stream's event types |
| `src/books.ts` | The bundled book data (`data/books.json`) and the forks (`data/forks.json`: one cut sentence per turning point) |
| `src/config.ts` | Bindings, vars, model settings |
| `migrations/` | D1 schema |
