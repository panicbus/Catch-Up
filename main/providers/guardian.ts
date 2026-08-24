import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { PROVIDER_CATEGORY } from './channelProfiles';
import { guardianProductionOffice, guardianSection } from './providerCountry';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from './cooldown';
import { fetchWithTimeout } from './fetchWithTimeout';

interface GuardianResult {
  webUrl?: string;
  webTitle?: string;
  webPublicationDate?: string;
  sectionName?: string;
  fields?: { trailText?: string; thumbnail?: string };
  tags?: { webTitle?: string }[];
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

    // The Guardian is the one provider where the country and category params INTERACT and must be
    // set together — its `politics` section means UK politics, so narrowing the office to `us`
    // without also widening the section to us-news collapses the result set to almost nothing
    // (verified live: 52 matches vs 11,271). guardianSection owns that pairing; never set one of
    // these two without the other. Note the office values are `uk`/`us`/`aus`, NOT ISO codes.
    const office = guardianProductionOffice(query.countryCode);
    const baseSection = query.category ? PROVIDER_CATEGORY.guardian[query.category] : undefined;
    const section = guardianSection(query.category, office, baseSection);
    const sectionParam = section ? `&section=${encodeURIComponent(section)}` : '';
    const officeParam = office ? `&production-office=${office}` : '';
    const url = `https://content.guardianapis.com/search?q=${encodeURIComponent(query.topic)}&api-key=${key}&show-fields=trailText,thumbnail&show-tags=keyword${sectionParam}${officeParam}`;
    try {
      const res = await fetchWithTimeout(url);
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
          section: r.sectionName ?? null,
          tags: r.tags?.map((t) => t.webTitle).filter((t): t is string => !!t) ?? null,
        }));
    } catch (e) {
      console.warn('[guardian] fetch error', e);
      return [];
    }
  },
};
