import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';

interface GuardianResult {
  webUrl?: string;
  webTitle?: string;
  webPublicationDate?: string;
  sectionName?: string;
  fields?: { trailText?: string; thumbnail?: string };
}

export const guardianProvider: NewsProvider = {
  id: 'guardian',
  label: 'The Guardian',
  isConfigured: () => !!process.env.GUARDIAN_API_KEY?.trim(),

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    const key = process.env.GUARDIAN_API_KEY?.trim();
    if (!key) {
      console.warn('[guardian] GUARDIAN_API_KEY not set — skipping.');
      return [];
    }
    const url = `https://content.guardianapis.com/search?q=${encodeURIComponent(query.topic)}&api-key=${key}&show-fields=trailText,thumbnail`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[guardian] request failed: ${res.status}`);
        return [];
      }
      const data = (await res.json()) as { response?: { results?: GuardianResult[] } };
      return (data.response?.results ?? [])
        .filter((r) => r.webUrl && r.webTitle)
        .map((r) => ({
          url: r.webUrl!,
          title: r.webTitle!,
          snippet: r.fields?.trailText?.replace(/<[^>]*>/g, '') ?? null,
          source: 'The Guardian',
          publishedAt: r.webPublicationDate ?? new Date().toISOString(),
          imageUrl: r.fields?.thumbnail ?? null,
        }));
    } catch (e) {
      console.warn('[guardian] fetch error', e);
      return [];
    }
  },
};
