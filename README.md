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
- **`/lab`** — "Waddle Lab": drive the pugglenaut with the real gait of
  [Microduck](https://github.com/pollen-robotics/microduck), a 25 cm bipedal
  robot. Joint motion is baked offline from the ONNX policies that ship on that
  robot and replayed on its exact skeleton by `src/lib/duck/`. `W`/`S` drive,
  `A`/`D` turn, and the skills are the robot's own — ground pick, roulade, the
  two kicks, and a sit/stand posture toggle. The 3D rig is procedural Three.js
  (`src/lib/duck/pugglenaut.ts`) — no mesh assets. The island is
  `client:visible`, and nothing animates until you power it on.
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

### Re-baking the duck motion

`public/duck/` is generated, not hand-written. To regenerate it you need
checkouts of [`microduck`](https://github.com/pollen-robotics/microduck) (for
`policies/*.onnx`) and
[`microduck_rl`](https://github.com/pollen-robotics/microduck_rl) (for the MJCF
model), plus [`uv`](https://docs.astral.sh/uv/). **No GPU is needed** — the bake
replays the policies on CPU MuJoCo, and needs none of the training stack:

```bash
uv run --no-project --with mujoco --with onnxruntime --with numpy \
    scripts/bake-duck-motion.py \
    --microduck ../microduck --microduck-rl ../microduck_rl
```

That writes three things:

| file | what |
| --- | --- |
| `public/duck/tree.json` | the kinematic tree — link offsets, joint limits, home pose |
| `public/duck/clips.json` | 12 velocity-grid gaits plus 6 skills |
| `src/lib/duck/fk-golden.json` | MuJoCo's own body transforms, as a test fixture |

Every number in the first is extracted from the MJCF rather than transcribed,
because a wrong link offset does not fail loudly — it produces a plausible
pugglenaut that walks wrong. `src/lib/duck/fk.test.ts` holds the TypeScript
forward kinematics to MuJoCo's answer to six decimals, which is what pins the
joint order and rotation conventions.

#### What the bake has to get right

Three things about the shipped policies are not guessable, and getting any of
them wrong produces motion that looks plausible and is wrong:

- **Most commands do nothing.** `alpha_walking` holds its stance below about
  `vx` 0.25 and will not turn below about `vyaw` 1.5, and above the threshold it
  delivers roughly 40% of what it was asked for. A lateral command produces no
  motion in either direction, so **strafing is not baked** — the policy cannot
  do it. Each clip therefore records the velocity it *achieved*, and the browser
  integrates the world position from that. Driving the root from the command
  instead is what makes a robot skate across the floor.
- **Skills carry command encodings.** The kicks and the roulade take an all-zero
  command — being selected is the trigger. The ground pick needs a *rotating*
  phase in the twist slots over a 4 s period, truncated at 0.7 of it. Sit and
  stand are one policy driven by a posture flag in the `vx` slot: `1` sits, `0`
  stands, so an all-zero command is the *stand*. All of this is
  `robotd/src/control.rs`.
- **Clips must loop on a whole gait cycle.** The period is found per clip by
  autocorrelation on the leg joints rather than assumed, because a fixed window
  leaves a visible hitch at every loop.

The site build never runs the bake and does not depend on those checkouts.
Both upstream repos are Apache 2.0; their 3D models are CC BY-SA-NC, and this
site ships no upstream mesh data — the pugglenaut is procedural.

## Deployment

Merging to `main` triggers
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which builds
with Astro and deploys to GitHub Pages. The custom domain is configured via
[`public/CNAME`](./public/CNAME).

Pull requests targeting `main` run the same build as a check but do not deploy:
GitHub's auto-created `github-pages` environment only accepts deployments from
the default branch, so a PR validates the build and merging publishes it.

> **One-time setup:** in the repo, go to **Settings → Pages → Build and
> deployment** and set **Source** to **GitHub Actions**. DNS for the apex domain
> must point at GitHub Pages (four `A` records to `185.199.108–111.153`, plus a
> `CNAME` on `www` → `mattea.github.io`).
