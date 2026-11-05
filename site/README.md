# NovelSpell Remix: site

The NovelSpell Remix site as a static [Astro](https://astro.build) build: the studio (`/`), `/terms`, `/privacy` and the 404. The
browser gets plain JavaScript compiled from TypeScript: no UI framework, no runtime, no hydration. It talks to the Remix API (the
server, `../server`, which also serves this build) only when the visitor acts.

## Commands

Node >= 22.12, npm (from this folder):

```sh
npm install
npm run dev      # dev server with reload
npm run build    # static site into dist/ (with public/_headers, the Cloudflare static headers file)
npm run preview  # serve dist/
npm run check    # astro check (TypeScript strict)
```

`PUBLIC_API_URL` (build time) sets the API origin the page calls (`/api/*` is appended); empty means same origin, and unset
means the hosted API (`src/config.ts`). For local work run the server (`../server`, `npm run dev`): it builds this site with
same-origin API calls into `../server/build/site` and serves the site and the API together (`wrangler dev --local`). The
hosted API is metered: do not aim test traffic at it. Deploys go through the server too (`../server`, `npm run deploy`): it
rebuilds this site into `../server/build/site` and ships it with the Worker, which serves it as static assets.

The CSP in `public/_headers` allows `connect-src 'self'`; a build that calls an absolute API origin (`PUBLIC_API_URL` unset, or set
to a URL) adds that origin to the built `_headers` (the `csp-api-origin` integration in `astro.config.mjs`).

## Layout

- `src/pages/`: the four pages plus `robots.txt.ts` and `sitemap.xml.ts` (generated from `src/config.ts` `site.origin`); `src/layouts/Page.astro`: the shell (head, SEO, fonts, theme, skip link, header, footer, script).
- `src/components/`: one file per element; `src/components/ui/`: Icon, Slotted, Dots, Ghosts, Cover, Picture,
  PicturePreload.
- `src/content/en.ts`: every word; `src/content/legal.ts`: the two policies; `src/data/`: books, featured remixes and
  `pictures.json` (the prepared picture manifest).
- `src/scripts/`: the browser script (`main.ts` + modules). `src/lib/`: build-time helpers (`text.ts`,
  `inlineScript.ts`, `firstPaint.ts` (the inline first-paint scripts), `pictures.ts` (`<picture>` markup from `pictures.json`),
  `logoId.ts` (unique SVG mask ids per inline logo)).
- `src/styles/index.css`: the site CSS in cascade order (framework layer, studio `studio/01-19`, 404, site layer, fonts);
  `src/styles/tailwind.css`: Tailwind 4 (theme, preflight, utilities) after it, in one bundled stylesheet.
- `public/`: static files served as-is (fonts, logos and favicons in `images/`, the book library in `library/`, story maps in
  `maps/`, the pre-compressed book and featured-remix pictures in `__assets/pictures/`, the fingerprinted share card in
  `__assets/images/`, `_headers`).

## Conventions

- **Words live in content.** Components read `en.ts` and the data files; nothing hard-codes text. Scripts never write words:
  every message is pre-rendered as hidden `data-messages` / `data-message` variants and the script picks one and fills its
  `data-slot` spans.
- **CSS-only animation, keyed by attributes.** Scripts set state attributes (`data-phase`, `data-on`, …); the CSS animates.
- **Zero layout shift.** Space for anything that arrives late (the chapter, the comic, restored state) is reserved in CSS; inline
  first-paint scripts (`src/lib/firstPaint.ts`, `src/layouts/theme.ts`) set the book, the theme and the restore state before
  the first frame.
- **No backend call on first paint.** The API is called only on a visitor's action, with one exception: a share link
  (`?share=<id>`) reads that remix from the API as the page loads (`src/scripts/studio/workspace.ts` `openShared`).
- **Markup is the contract.** The CSS selects on `data-classlist` tokens and `data-*` hooks under `#SiteDocument #SiteBody`; keep
  them when editing markup.
- **No UI framework**, no client runtime; Tailwind utilities come only from `src/**/*.astro` and `src/scripts/**`.

## Licences

- Fonts (self-hosted in `public/fonts/`): Playfair Display and Wix Madefor Display, SIL Open Font License 1.1; the licence text
  sits beside each family (`LICENSE.txt`).
- Icons (`src/icons/`): Lucide (ISC) and Tabler Icons (MIT); see `src/icons/LICENSES.md`.
- The Instagram, Facebook and WhatsApp logos (`src/components/MetaShareLogos.astro`) are trademarks of Meta Platforms, Inc.,
  used as provided in Meta's brand resources (about.meta.com/brand/resources).
- The NovelSpell name and logo are trademarks of Frostwave Labs Inc.
