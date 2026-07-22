import type { FetchedArticle, NewsProvider, ProviderQuery } from './types';
import { newsDataProvider } from './newsdata';
import { guardianProvider } from './guardian';
import { gNewsProvider } from './gnews';
import { googleNewsRssProvider } from './googleNewsRss';
import { hackerNewsProvider } from './hackerNews';
import { nytimesProvider } from './nytimes';
import { isCoolingDown } from './cooldown';

const primaryProviders: NewsProvider[] = [newsDataProvider, guardianProvider, gNewsProvider, hackerNewsProvider, nytimesProvider];

// Google News RSS is a last resort, not an equal peer: its feed has no images at all, its
// "snippet" field is just a restated headline (not a real summary), and — worse — its loose
// keyword search on a short/ambiguous channel name like "Tech" pulls in unrelated noise (e.g.
// "Virginia Tech" sports stories for a technology channel) in high enough volume to crowd out
// every other, more relevant source within the display cap. Only queried when the primary
// providers don't turn up enough on their own for this specific search.
const fallbackProviders: NewsProvider[] = [googleNewsRssProvider];

export const providers: NewsProvider[] = [...primaryProviders, ...fallbackProviders];

const MIN_ARTICLES_BEFORE_FALLBACK = 5;

async function runSet(set: NewsProvider[], query: ProviderQuery): Promise<FetchedArticle[]> {
  const configured = set.filter((p) => p.isConfigured());
  const results = await Promise.allSettled(configured.map((p) => p.fetchArticles(query)));
  // Promise.allSettled preserves input order, so results[i] always corresponds to configured[i] —
  // tagging each provider's own results here (rather than after everything's flattened together)
  // is what lets a fetched article ever record its real source instead of a generic placeholder.
  return results.flatMap((r, i) =>
    r.status === 'fulfilled' ? r.value.map((a) => ({ ...a, provider: configured[i].id })) : []
  );
}

export async function runProviders(query: ProviderQuery): Promise<FetchedArticle[]> {
  // No console output here even when zero providers are configured — that state is visible in
  // Settings' provider panel, and isn't something a background refresh cycle should be noisy about.
  const primary = await runSet(primaryProviders, query);
  if (primary.length >= MIN_ARTICLES_BEFORE_FALLBACK) return primary;
  const fallback = await runSet(fallbackProviders, query);
  return [...primary, ...fallback];
}

export function getProviderStatus(): { id: string; label: string; configured: boolean; rateLimited: boolean }[] {
  return providers.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    rateLimited: isCoolingDown(p.id),
  }));
}
