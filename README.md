# pugglenaut.com

The Pugglenaut website — an [Astro](https://astro.build) static site styled with
the **Retropolis** design system (`@retropolis/ui`), deployed to GitHub Pages on
the custom domain [pugglenaut.com](https://pugglenaut.com).

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to ./dist
npm run preview  # preview the production build
```

## How it's put together

- **Astro** renders pages to static HTML. React components from the design
  system render to HTML at build time and ship **zero JavaScript** unless a
  component opts into hydration with a `client:*` directive (see
  `src/components/LaunchControl.tsx`).
- **Design system** — the built `@retropolis/ui` package is *vendored* under
  [`vendor/retropolis-ui`](./vendor/retropolis-ui) and wired in via a
  `file:` dependency. The site imports components from `@retropolis/ui` and its
  stylesheet from `@retropolis/ui/styles.css` (loaded in
  `src/layouts/Base.astro`).

## What's on the site

Pages (`src/pages/`):

- **`/`** — home base: hero, a constellation **star map** that navigates the
  site (`StarMap.astro`, pure SVG/CSS, zero JS), the launch-bay toy, and live
  ship **telemetry** gauges.
- **`/logbook`** — a blog ("transmissions"). Posts are Markdown in
  `src/content/logbook/`, defined by the `logbook` content collection
  (`src/content.config.ts`). Add a file with `title`, `stardate`, and `summary`
  frontmatter and it appears automatically, newest first; set `draft: true` to
  hide it.
- **`/game`** — "Arcade": *Puggle Drift*, a TypeScript `<canvas>` game
  (`src/components/PuggleGame.tsx`). One-button jetpack dodger; local best in
  `localStorage`, with a global leaderboard when the backend is live.
- **`/guestbook`** — sign-the-wall guestbook (backend-backed; a read-only sample
  wall in fallback mode).
- **`/contact`** — a "Signal" form that delivers a message (backend-backed; a
  prefilled `mailto:` in fallback mode).
- **`/now`** — a small-web [/now page](https://nownownow.com).
- **`/colophon`** — "ship schematics": how the site is built, plus a live
  gallery of Retropolis components.
- **`/links`** — "Star Charts": a curated link directory.
- **`/rss.xml`** — an RSS feed of the Logbook. A sitemap is generated too
  (`@astrojs/sitemap`).
- **`404`** — a "lost in space" page.

### Themes & opt-in effects

The header **ControlDeck** (`src/components/ControlDeck.tsx`, the one always-on
island) gathers a **theme lab** (Paper / CRT / Sketch — just a `data-rp-theme`
value on `<html>`) and every playful extra. To keep the page calm, nothing
animated runs by default — each effect is behind an explicit control and honors
`prefers-reduced-motion`:

- **Boot sequence** (▶ power icon) — a skippable retro POST screen.
- **Time-aware sky** (clock icon) — tints the background to the visitor's local
  hour. Persisted; restored pre-paint in `Base.astro`.
- **Bubble trail** (sparkle icon) — bubbles follow the cursor. Persisted.
- **Mission Control** (console icon, or the <kbd>`</kbd> key) — a fake terminal
  that navigates the site and drives the effects; type `help`.
- **Konami code** (↑↑↓↓←→←→ B A) — a hidden barrel roll.

The shared, framework-agnostic effect logic lives in `src/lib/effects.ts`;
theme logic in `src/lib/theme.ts`.

## Live features & the backend

The guestbook, contact form, visitor hit counter, status beacon, and game
leaderboard talk to a small **Cloudflare Worker** (D1 + KV) in
[`backend/`](./backend). GitHub Pages only serves static files, so the Worker is
deployed separately — see [`backend/README.md`](./backend/README.md) for the
`wrangler` walkthrough (create D1 + KV, set secrets, deploy).

Everything **degrades gracefully**: the frontend reads the Worker URL from the
`PUBLIC_API_BASE` build-time env var (see `src/lib/api.ts`). When it's empty —
the default — `apiEnabled` is false and each feature falls back to a
static/local experience (sample guestbook, `mailto:` contact, decorative
counter, neutral beacon, local-only best score), so the site is fully functional
before any backend exists.

To switch the live features on: deploy the Worker, then set a repository
**Variable** named `PUBLIC_API_BASE` (Settings → Secrets and variables →
Actions → Variables) to the Worker URL (e.g.
`https://pugglenaut-api.<subdomain>.workers.dev`, no trailing slash). The deploy
workflow passes it through at build time. Flip the status beacon with an
authenticated `POST /api/status` (see `backend/README.md`).

### Updating the design system

The design system is vendored (a copy of its build), so it does not auto-update.
To pull in a new version, rebuild `mattea/design-system` and copy its `dist/`
over [`vendor/retropolis-ui/dist`](./vendor/retropolis-ui/dist):

```bash
# in a checkout of mattea/design-system
node scripts/fetch-fonts.mjs && npm run build

# then, in this repo
rm -rf vendor/retropolis-ui/dist
cp -r ../design-system/dist vendor/retropolis-ui/dist
```

## Deployment

Pushing to `claude/whimsical-warbles-setup-odk9m5` triggers
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which builds
with Astro and deploys to GitHub Pages. The custom domain is configured via
[`public/CNAME`](./public/CNAME).

> **One-time setup:** in the repo, go to **Settings → Pages → Build and
> deployment** and set **Source** to **GitHub Actions**. DNS for the apex domain
> must point at GitHub Pages (four `A` records to `185.199.108–111.153`, plus a
> `CNAME` on `www` → `mattea.github.io`).
