import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';

interface GNewsResult {
  url?: string;
  title?: string;
  description?: string;
  source?: { name?: string };
  publishedAt?: string;
  image?: string;
}

export const gNewsProvider: NewsProvider = {
  id: 'gnews',
  label: 'GNews',
  isConfigured: () => !!process.env.GNEWS_API_KEY?.trim(),

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    const key = process.env.GNEWS_API_KEY?.trim();
    if (!key) {
      console.warn('[gnews] GNEWS_API_KEY not set — skipping.');
      return [];
    }
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query.topic)}&lang=en&token=${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[gnews] request failed: ${res.status}`);
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
