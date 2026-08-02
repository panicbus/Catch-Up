import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from './cooldown';
import { fetchWithTimeout } from './fetchWithTimeout';

interface HnHit {
  objectID: string;
  title?: string;
  url?: string | null;
  story_text?: string | null;
  created_at?: string;
}

const PROVIDER_ID = 'hackernews';

/** Free, unauthenticated (Algolia-hosted HN search) — narrow to just the Tech channel's kind of
 * coverage on purpose, so it's a deliberate strengthener rather than another general-purpose
 * aggregator. */
export const hackerNewsProvider: NewsProvider = {
  id: PROVIDER_ID,
  label: 'Hacker News',
  isConfigured: () => true,

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    if (isCoolingDown(PROVIDER_ID)) return [];

    // Capped well below Algolia's default of 20/page — almost none of these have a snippet (see
    // the map below), so an uncapped query can dump a wall of snippet-less cards into a single
    // channel/subchannel's results at once. This keeps Hacker News a supplement, not a flood.
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query.topic)}&tags=story&hitsPerPage=6`;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        if (isHardFailureStatus(res.status)) startCooldown(PROVIDER_ID, RATE_LIMIT_COOLDOWN_MS);
        return [];
      }
      const data = (await res.json()) as { hits?: HnHit[] };
      return (data.hits ?? [])
        .filter((h) => h.title)
        .map((h) => ({
          // "Ask HN" / text posts have no external url — fall back to the HN discussion itself.
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          title: h.title!,
          snippet: h.story_text ? h.story_text.slice(0, 300) : null,
          source: 'Hacker News',
          publishedAt: h.created_at ?? new Date().toISOString(),
          imageUrl: null,
        }));
    } catch (e) {
      console.warn('[hackernews] fetch error', e);
      return [];
    }
  },
};
