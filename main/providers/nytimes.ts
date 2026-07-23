import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from './cooldown';
import { throttle } from './pacing';

// NYT's free tier allows 5 requests/minute — far stricter than every other provider here, and
// stricter than refreshAgent's default 300ms cross-provider pacing was ever tuned for. A refresh
// cycle fans out one query per channel plus staggered subchannels, all only 300ms apart, which
// would burst well past 5/min in the first few seconds of every single cycle. 25s between actual
// NYT calls caps this provider at under 3/min on its own, a comfortable margin below the limit
// even accounting for jitter, rather than pacing right up against it.
const NYT_MIN_INTERVAL_MS = 25 * 1000;

interface NytDoc {
  web_url?: string;
  headline?: { main?: string };
  abstract?: string;
  pub_date?: string;
  multimedia?: { url?: string }[];
}

const PROVIDER_ID = 'nytimes';

export const nytimesProvider: NewsProvider = {
  id: PROVIDER_ID,
  label: 'The New York Times',
  isConfigured: () => !!process.env.NYTIMES_API_KEY?.trim(),

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    const key = process.env.NYTIMES_API_KEY?.trim();
    if (!key) return [];
    if (isCoolingDown(PROVIDER_ID)) return [];

    await throttle(PROVIDER_ID, NYT_MIN_INTERVAL_MS);

    const url = `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${encodeURIComponent(query.topic)}&api-key=${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (isHardFailureStatus(res.status)) startCooldown(PROVIDER_ID, RATE_LIMIT_COOLDOWN_MS);
        return [];
      }
      const data = (await res.json()) as { response?: { docs?: NytDoc[] } };
      return (data.response?.docs ?? [])
        .filter((d) => d.web_url && d.headline?.main)
        .map((d) => {
          // Multimedia URLs from this API are host-relative, unlike everything else in the payload.
          const image = d.multimedia?.[0]?.url;
          return {
            url: d.web_url!,
            title: d.headline!.main!,
            snippet: d.abstract ?? null,
            source: 'The New York Times',
            publishedAt: d.pub_date ?? new Date().toISOString(),
            imageUrl: image ? `https://www.nytimes.com/${image}` : null,
          };
        });
    } catch (e) {
      console.warn('[nytimes] fetch error', e);
      return [];
    }
  },
};
