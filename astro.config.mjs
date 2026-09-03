// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// Custom apex domain served by GitHub Pages (see public/CNAME).
// Apex domain => site is the bare origin and base stays at '/'.
export default defineConfig({
  site: 'https://pugglenaut.com',
  base: '/',
  integrations: [react(), sitemap()],
  vite: {
    worker: {
      // The Waddle Lab physics worker imports MuJoCo's emscripten glue, which
      // has a top-level `await import('module')` behind a node check. Vite's
      // default worker format is IIFE, and IIFE cannot hold a top-level await,
      // so the build fails outright without this. Module workers are the only
      // thing that can carry that file.
      format: 'es',
    },
  },
});
