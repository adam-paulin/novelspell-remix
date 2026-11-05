# NovelSpell Remix

Pick a classic, ask "what if", and get the chapter the author never wrote, in the author's voice, drawn as a comic page, with the cover of the book that now exists.

**Live demo:** https://novelspell-remix.apptory.workers.dev · **Demo video:** https://www.youtube.com/watch?v=awxTZDHM2rI

## What existed before vs. what was built at the hackathon

Before this hackathon, NovelSpell already sold classic books, and this week I built Remix: a fork button for the classics.

- All of Remix was built October 26 – November 4, 2026, for the Meta Global AI Developer Hackathon, on public-domain texts. NovelSpell's store, books, covers, pipelines and code are not part of it. The app only links out to novelspell.com. The one pre-existing piece it carries is NovelSpell's own browser-tab icon (the favicon), used unchanged.
- Every model the app calls at runtime is a Meta model: Muse Wonder writes each chapter and Muse Image draws each comic page, through the Meta Model API. In Fast mode (the reader's toggle) Muse Spark Open, Meta's open-weights model, writes the chapter instead, served by Baseten.
- Code written with Claude and Codex assistance.

The one thing not made at runtime is each book's map (its cast, timeline and the turning points a reader can fork from). The maps were made once, before the app runs, with OpenAI models and AI-assisted edits, checked against the book text by code checks and a second model's review, and they ship as data in this repository. No reader request calls a non-Meta model.

## Meta models used

| Model | Where it runs | What it does in the product |
| --- | --- | --- |
| Muse Wonder 1.0 (`muse-wonder-1.0`; medium, xhigh or max effort, set by the reader's Thinking setting) | Meta Model API (Responses API, streamed) | Writes each chapter and each revision: six key events first, then the prose |
| Muse Image 1.0 (`muse-image-1.0`, high reasoning strength) | Meta Model API | Draws the cover of the forked book, with a title it invents, and the chapter as one multi-panel comic page |
| Muse Spark Open (`meta-models/muse-spark-open-1026`; medium, high or xhigh effort, set by the same Thinking setting) | Baseten (partner inference) | Fast mode only: writes the chapter and its revisions instead of Muse Wonder, so the first words appear much sooner |

To see which models a running copy calls, open `/api/health`: it lists the writer (normal and Fast mode, with the effort behind each Thinking level) and the illustrator. Finished examples on the page show the Meta models that made them.

## Try it

**Live demo:** https://novelspell-remix.apptory.workers.dev. No login and no setup. It runs on our model credit up to a set budget per provider; once the Meta budget is spent, the page shows finished remixes you can still read. Your remixes stay in your own browser.

A three-minute tour:

1. Pick **Frankenstein**, then the turning point **The Maker Stays**, and keep its "what if" (Victor stays when the creature reaches toward him, and tries to care for him).
2. Press **Write the chapter**. The cover of your forked book starts at once; the chapter then streams in Mary Shelley's voice while the comic page is drawn from its events. (The **Thinking** setting beside it lets the writer reason longer for a more careful chapter.)
3. Open the comic page: the whole chapter, drawn in reading order.
4. Ask for a change in plain words (for example "Make the ending more unsettling") and press **Revise**. Every version is kept.
5. Turn on **Fast mode** and write again: Muse Spark Open on Baseten writes the chapter, and the first words arrive much sooner.

### Run it locally for free (no API key)

Requires Node.js 22.12+ and npm.

```sh
npm run setup            # installs site/ and server/ from their lockfiles
npm run dev:mock         # builds the site, then serves the whole app on http://localhost:8787
```

Other root scripts: `npm test` (the server's offline test suite), `npm run typecheck` and `npm run smoke` (typecheck, tests, then the site build).

The free mode answers every model call from a local stand-in that replays chapters and pictures Meta's models already made, so nothing is sent anywhere and nothing is spent. Use it to see the whole flow; the replayed chapter need not match the book or the "what if" you pick (Frankenstein matches best).

### Run it locally with the real models

After `npm run setup` above:

```sh
cd server
cp dev.vars.example .dev.vars      # set META_MODEL_API_KEY and VERSION_SECRET (32+ characters); BASETEN_API_KEY enables Fast mode
npm run db:migrate:local           # creates the local D1 tables (the spend ledger)
npm run dev                        # http://localhost:8787
```

This spends your own Meta (and, in Fast mode, Baseten) credit. Without `BASETEN_API_KEY`, Fast mode says it is unavailable and normal mode works as usual. Every setting, the API and how to deploy your own copy to Cloudflare are in [server/README.md](server/README.md).

## How it works

```
reader's browser ── every remix and version is kept here
        │  POST /api/remix  (or /api/remix/revise, /api/remix/redraw)
        ▼        ▲ one streamed response: the prose, the pictures, a signed version token
one Cloudflare Worker (serves the site and the API; D1 holds the spend ledger, a write-only record of preset what-if runs and the remixes readers choose to share)
        ├─ spend cap per provider ── every call reserves its estimate first, then books its actual cost
        ├─ Muse Image 1.0 ── the cover, at once
        ├─ writer ── Muse Wonder 1.0 on Meta, or Muse Spark Open on Baseten in Fast mode (the Thinking setting picks its effort)
        │            streams six events, then the chapter
        └─ Muse Image 1.0 ── the comic page, the moment the six events are complete, while the prose still streams
```

- **Book maps.** Each of the ten public-domain books ships with a precompiled map: the cast and their motives, the timeline, who knows what at each point, the world's rules and the turning points where the story can split. The page offers those turning points. The writer reads the original chapter cut at the chosen one (the text before the fork and the text it replaces), so the new chapter stays true to the book up to the moment it changes. A reader can also type a free "what if": it forks at the closest turning point. The maps also name who appears in each comic.
- **One streamed answer, checked as it arrives.** The writer answers in a fixed shape: `{"events": [six strings], "chapter": "..."}`, events first. The Worker checks that opening character by character. If it goes wrong (prose instead of events, another key first, events that don't fit), the call is cut and asked again at once, before the reader sees anything. Only when the six events have closed and passed does the comic start and the prose begin streaming to the page.
- **Pictures in parallel.** The cover starts the moment the reader presses Write; the comic starts from the events while the chapter is still being written, so the reader waits for one model, not three in a row.
- **Revisions.** A revision is its own call on the reader's latest version: it decides what the instruction reaches and is asked to keep everything else word for word. It writes its own six events, so the comic is drawn again.
- **Stateless and budgeted.** A reader's remixes and versions live in their browser, and revising needs no stored state: each finished version leaves as a signed token the browser sends back to revise or redraw. Meta and Baseten each have their own spend cap. A call starts only if its estimated cost fits under its provider's cap (one atomic reservation in D1), and its actual cost is booked when it ends, so no call starts once a budget is spent; calls already running can go slightly past it.
- **Retries and stops.** A failed call (a wrong start caught by the streaming check, a refusal, a cut or stalled stream, a timeout, an unusable picture, a 429 or 5xx) is tried up to 3 more times (a picture up to 8), with backoff for 429 and 5xx. A visitor who leaves stops the writing within a second. Other 4xx errors are never retried, except a picture refused for content policy (Muse Image refusals vary from try to try and are not billed). A refused Meta key or a spent Meta budget switches the page to the finished examples; in Fast mode, a missing or refused Baseten key or a spent Baseten budget says Fast mode is unavailable, and normal mode keeps working.

Every word the models read is in [server/src/prompts/](server/src/prompts/): one file per prompt (writer, revise, cover, comic) on one shared core that builds each request with a stable, cacheable prefix.

## Repository layout

| Path | What it is |
| --- | --- |
| `package.json` | Root scripts only (`setup`, `dev:mock`, `dev`, `test`, `typecheck`, `build`, `smoke`); `site/` and `server/` are separate npm packages with their own lockfiles. |
| [`server/`](server/README.md) | The Cloudflare Worker (TypeScript, Hono, Zod, D1): the API, the prompts, the model calls, the spend caps, the free local mode (`mock/`) and the test suite (`test/`, `npm test`: offline, no keys). It also serves the built site. |
| [`site/`](site/README.md) | The static site (Astro, compiled to plain JavaScript with no UI framework): the studio, the book data, the maps and the finished example remixes. |

## Licence

PolyForm Noncommercial 1.0.0. Copyright (c) 2026 Frostwave Labs Inc. Commercial licences are available from Frostwave Labs Inc.

The full source is public: anyone may read, run, modify and share it for any noncommercial purpose (see `LICENSE`).
