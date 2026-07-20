import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from './cooldown';

interface GuardianResult {
  webUrl?: string;
  webTitle?: string;
  webPublicationDate?: string;
  sectionName?: string;
  fields?: { trailText?: string; thumbnail?: string };
}

const PROVIDER_ID = 'guardian';

export const guardianProvider: NewsProvider = {
  id: PROVIDER_ID,
  label: 'The Guardian',
  isConfigured: () => !!process.env.GUARDIAN_API_KEY?.trim(),

  async fetchArticles(query: ProviderQuery): Promise<ProviderArticle[]> {
    const key = process.env.GUARDIAN_API_KEY?.trim();
    if (!key) return [];
    if (isCoolingDown(PROVIDER_ID)) return [];

    const url = `https://content.guardianapis.com/search?q=${encodeURIComponent(query.topic)}&api-key=${key}&show-fields=trailText,thumbnail`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Expected/routine on a free tier — quotas and occasional hiccups aren't developer-actionable
        // noise. Rate-limit state surfaces to the user instead, via the Settings provider panel and
        // a manual refresh's result, not the console.
        if (isHardFailureStatus(res.status)) startCooldown(PROVIDER_ID, RATE_LIMIT_COOLDOWN_MS);
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
