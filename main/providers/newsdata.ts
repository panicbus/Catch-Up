import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { PROVIDER_CATEGORY } from './channelProfiles';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from './cooldown';

interface NewsDataResult {
  link?: string;
  title?: string;
  description?: string;
  source_id?: string;
  pubDate?: string;
  image_url?: string;
  category?: string[];
  keywords?: string[];
}

const PROVIDER_ID = 'newsdata';

export const newsDataProvider: NewsProvider = {
  id: PROVIDER_ID,
  label: 'NewsData.io',
  isConfigured: () => !!process.env.NEWSDATA_API_KEY?.trim(),

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    const key = process.env.NEWSDATA_API_KEY?.trim();
    if (!key) return [];
    if (isCoolingDown(PROVIDER_ID)) return [];

    const cat = query.category ? PROVIDER_CATEGORY.newsdata[query.category] : undefined;
    const catParam = cat ? `&category=${cat}` : '';
    const url = `https://newsdata.io/api/1/news?apikey=${key}&q=${encodeURIComponent(query.topic)}&language=en${catParam}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Expected/routine on a free tier — quotas and occasional hiccups aren't developer-actionable
        // noise. Rate-limit state surfaces to the user instead, via the Settings provider panel and
        // a manual refresh's result, not the console.
        if (isHardFailureStatus(res.status)) startCooldown(PROVIDER_ID, RATE_LIMIT_COOLDOWN_MS);
        return [];
      }
      const data = (await res.json()) as { results?: NewsDataResult[] };
      return (data.results ?? [])
        .filter((r) => r.link && r.title)
        .map((r) => ({
          url: r.link!,
          title: r.title!,
          snippet: r.description ?? null,
          source: r.source_id ?? 'NewsData',
          publishedAt: r.pubDate ? new Date(r.pubDate).toISOString() : new Date().toISOString(),
          imageUrl: r.image_url ?? null,
          section: r.category?.[0] ?? null,
          tags: r.keywords ?? null,
        }));
    } catch (e) {
      console.warn('[newsdata] fetch error', e);
      return [];
    }
  },
};
