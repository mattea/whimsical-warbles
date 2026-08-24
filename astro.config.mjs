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
});
