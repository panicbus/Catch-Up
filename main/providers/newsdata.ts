import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';

interface NewsDataResult {
  link?: string;
  title?: string;
  description?: string;
  source_id?: string;
  pubDate?: string;
  image_url?: string;
}

export const newsDataProvider: NewsProvider = {
  id: 'newsdata',
  label: 'NewsData.io',
  isConfigured: () => !!process.env.NEWSDATA_API_KEY?.trim(),

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    const key = process.env.NEWSDATA_API_KEY?.trim();
    if (!key) {
      console.warn('[newsdata] NEWSDATA_API_KEY not set — skipping.');
      return [];
    }
    const url = `https://newsdata.io/api/1/news?apikey=${key}&q=${encodeURIComponent(query.topic)}&language=en`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[newsdata] request failed: ${res.status}`);
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
        }));
    } catch (e) {
      console.warn('[newsdata] fetch error', e);
      return [];
    }
  },
};
