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
