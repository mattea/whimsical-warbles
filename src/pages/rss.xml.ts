import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

/**
 * RSS feed for the Logbook — the small-web way to let people follow along
 * without an account. Served at /rss.xml. Mirrors the index's filter (no
 * drafts) and ordering (newest first).
 */
export async function GET(context: APIContext) {
  const entries = (await getCollection('logbook', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.stardate.getTime() - a.data.stardate.getTime(),
  );

  return rss({
    title: 'Pugglenaut · Logbook',
    description: 'Transmissions from orbit — dev notes, doodles, and warbles into the void.',
    site: context.site ?? 'https://pugglenaut.com',
    items: entries.map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.stardate,
      description: entry.data.summary,
      link: `/logbook/${entry.id}/`,
      categories: entry.data.tags,
    })),
    customData: '<language>en-us</language>',
  });
}
