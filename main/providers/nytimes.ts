import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from './cooldown';
import { fetchWithTimeout } from './fetchWithTimeout';
import { tryReserve } from './pacing';

// NYT's free tier allows 5 requests/minute — far stricter than every other provider here, and
// stricter than refreshAgent's default 300ms cross-provider pacing was ever tuned for. A refresh
// cycle fans out one query per channel plus staggered subchannels, all only 300ms apart, which
// would burst well past 5/min in the first few seconds of every single cycle. 25s between actual
// NYT calls caps this provider at under 3/min on its own, a comfortable margin below the limit
// even accounting for jitter, rather than pacing right up against it.
//
// This spacing is enforced by SKIPPING, not waiting — see the reasoning in pacing.ts. Waiting here
// used to dominate refresh wall-clock time: every provider runs inside one Promise.allSettled, so a
// 25s wait on this one source held up all the others, once per search. A channel with 4 subchannels
// (5 searches) spent ~100s idle on this alone; measured live at 1m42s before the change.
//
// The yield cost is smaller than it looks, and is arguably a fix in itself: NYT's free tier is also
// 500 requests/DAY. Waiting meant every search eventually got its own NYT call — roughly 20 targets
// x 48 background sweeps ≈ 960 calls/day, nearly 2x the daily cap, so NYT was likely spending large
// stretches of each day locked out on a 429 cooldown returning nothing at all. Skipping lands at
// ~50-100/day, inside quota, and spends those calls on the channel-level search (the first target),
// which is the broadest and highest-value query.
const NYT_MIN_INTERVAL_MS = 25 * 1000;

interface NytDoc {
  web_url?: string;
  headline?: { main?: string };
  abstract?: string;
  pub_date?: string;
  multimedia?: { url?: string }[];
  section_name?: string;
  news_desk?: string;
  keywords?: { value?: string }[];
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

    // After the cooldown check on purpose — a cooling-down NYT shouldn't burn a reservation slot it
    // can't use, which would then make the NEXT eligible search skip too.
    if (!tryReserve(PROVIDER_ID, NYT_MIN_INTERVAL_MS)) return [];

    const url = `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${encodeURIComponent(query.topic)}&api-key=${key}`;
    try {
      const res = await fetchWithTimeout(url);
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
            // Read the desk/section back as a relevance signal. No server-side fq filter: NYT is
            // rate-limited (5/min) and its desk/section values don't map cleanly to our categories
            // (entertainment → Arts/Movies/Culture, politics → news_desk not section_name), so a wrong
            // fq would waste a scarce call by returning nothing. The scorer reads this instead.
            section: d.section_name ?? d.news_desk ?? null,
            tags: d.keywords?.map((k) => k.value).filter((v): v is string => !!v) ?? null,
          };
        });
    } catch (e) {
      console.warn('[nytimes] fetch error', e);
      return [];
    }
  },
};
