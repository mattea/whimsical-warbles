import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * The Logbook — ship's-log entries. Content lives as Markdown in
 * src/content/logbook/. Each post is a "transmission" with a stardate.
 * Set `draft: true` to keep an entry out of the built index.
 */
const logbook = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/logbook' }),
  schema: z.object({
    title: z.string(),
    stardate: z.coerce.date(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { logbook };
