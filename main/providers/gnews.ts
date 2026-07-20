import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from './cooldown';

interface GNewsResult {
  url?: string;
  title?: string;
  description?: string;
  source?: { name?: string };
  publishedAt?: string;
  image?: string;
}

const PROVIDER_ID = 'gnews';

export const gNewsProvider: NewsProvider = {
  id: PROVIDER_ID,
  label: 'GNews',
  isConfigured: () => !!process.env.GNEWS_API_KEY?.trim(),

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    const key = process.env.GNEWS_API_KEY?.trim();
    if (!key) return [];
    if (isCoolingDown(PROVIDER_ID)) return [];

    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query.topic)}&lang=en&token=${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Expected/routine on a free tier — quotas and occasional hiccups aren't developer-actionable
        // noise. Rate-limit state surfaces to the user instead, via the Settings provider panel and
        // a manual refresh's result, not the console.
        if (isHardFailureStatus(res.status)) startCooldown(PROVIDER_ID, RATE_LIMIT_COOLDOWN_MS);
        return [];
      }
      const data = (await res.json()) as { articles?: GNewsResult[] };
      return (data.articles ?? [])
        .filter((r) => r.url && r.title)
        .map((r) => ({
          url: r.url!,
          title: r.title!,
          snippet: r.description ?? null,
          source: r.source?.name ?? 'GNews',
          publishedAt: r.publishedAt ?? new Date().toISOString(),
          imageUrl: r.image ?? null,
        }));
    } catch (e) {
      console.warn('[gnews] fetch error', e);
      return [];
    }
  },
};
