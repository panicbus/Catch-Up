import Parser from 'rss-parser';
import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from './cooldown';
import { fetchWithTimeout } from './fetchWithTimeout';

const PROVIDER_ID = 'googlenewsrss';
const parser = new Parser();

/** No API key, no signup — Google News RSS takes an arbitrary search query the same way the
 * keyed providers do, and aggregates across thousands of outlets rather than one newsroom's own
 * coverage. Deliberately run as a last resort (see registry.ts) rather than an equal peer: no
 * images, a "snippet" that's really just a restated headline, and a loose keyword search prone
 * to unrelated noise on short/ambiguous topics (e.g. "Virginia Tech" sports stories for a
 * channel named "Tech"). Still useful as backfill when the richer sources come up short. */
export const googleNewsRssProvider: NewsProvider = {
  id: PROVIDER_ID,
  label: 'Google News (RSS)',
  isConfigured: () => true,

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    if (isCoolingDown(PROVIDER_ID)) return [];

    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query.topic)}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        // Unofficial endpoint — a sustained block reads the same as a hard failure elsewhere.
        if (isHardFailureStatus(res.status)) startCooldown(PROVIDER_ID, RATE_LIMIT_COOLDOWN_MS);
        return [];
      }
      const xml = await res.text();
      const feed = await parser.parseString(xml);
      return (feed.items ?? [])
        .filter((item) => item.link && item.title)
        // This feed can return up to ~100 items per query with no way to ask for fewer server-side,
        // and every one of them is guaranteed snippet-less and image-less (see below) — uncapped,
        // a single fallback firing can flood a channel with far more empty cards than every richer
        // source combined. Capped to match the same modest-supplement role as Hacker News.
        .slice(0, 10)
        .map((item) => {
          // Google News RSS titles come as "Headline - Source Name" — split on the *last*
          // " - " so a headline that itself contains " - " doesn't get chopped mid-sentence.
          const title = item.title!;
          const splitAt = title.lastIndexOf(' - ');
          const headline = splitAt === -1 ? title : title.slice(0, splitAt);
          const source = splitAt === -1 ? 'Google News' : title.slice(splitAt + 3);
          return {
            url: item.link!,
            title: headline,
            // item.contentSnippet here isn't a real summary — it's Google's own list of related
            // headlines from the same story cluster (often just repeating this one, sometimes
            // several "Headline - Source" lines stacked up), so it reads as redundant/noisy
            // rather than informative. Leaving it null renders as no snippet, same as Hacker
            // News already does, instead of cluttering the card with a restated headline.
            snippet: null,
            source,
            publishedAt: item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()),
            // No reliable image field in this feed.
            imageUrl: null,
          };
        });
    } catch (e) {
      console.warn('[googlenewsrss] fetch error', e);
      return [];
    }
  },
};
