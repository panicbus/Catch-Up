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

/** Optional runtime check on top of isConfigured() — a provider can be configured (has a key) but
 * still be paced out of THIS run because its shared daily allowance is exhausted for now (see
 * server/stores/providerUsage.ts, the only real implementation). Kept as a plain interface here
 * rather than importing the store directly, so this pure, Electron-agnostic folder never depends on
 * server/ or Postgres — the desktop app calls runProviders with no gate at all and every provider
 * behaves exactly as it always has. */
export interface ProviderGate {
  /** false = skip this provider entirely for the rest of this gate's lifetime; no request is made. */
  allow(providerId: string): boolean;
  /** Called once per provider actually queried (regardless of success/failure — the request itself
   * is what spends the allowance), so the gate's owner can track and later persist real usage. */
  spent(providerId: string): void;
}

async function runSet(set: NewsProvider[], query: ProviderQuery, gate?: ProviderGate): Promise<FetchedArticle[]> {
  // isCoolingDown, not just isConfigured: a provider mid-cooldown (see cooldown.ts) already
  // short-circuits its own fetchArticles to [] internally, making no real request at all — so
  // gate.spent() must not fire for it either, or a paced gate (providerUsage.ts) would record real
  // "spend" for a request that never happened. Over an hour-long cooldown, one per channel/
  // subchannel target adds up fast, artificially exhausting that provider's allowance for the rest
  // of the day even after the real rate limit has already recovered.
  const configured = set.filter((p) => p.isConfigured() && !isCoolingDown(p.id) && (!gate || gate.allow(p.id)));
  const results = await Promise.allSettled(configured.map((p) => p.fetchArticles(query)));
  configured.forEach((p) => gate?.spent(p.id));
  // Promise.allSettled preserves input order, so results[i] always corresponds to configured[i] —
  // tagging each provider's own results here (rather than after everything's flattened together)
  // is what lets a fetched article ever record its real source instead of a generic placeholder.
  return results.flatMap((r, i) =>
    r.status === 'fulfilled' ? r.value.map((a) => ({ ...a, provider: configured[i].id })) : []
  );
}

export async function runProviders(query: ProviderQuery, gate?: ProviderGate): Promise<FetchedArticle[]> {
  // No console output here even when zero providers are configured — that state is visible in
  // Settings' provider panel, and isn't something a background refresh cycle should be noisy about.
  const primary = await runSet(primaryProviders, query, gate);
  if (primary.length >= MIN_ARTICLES_BEFORE_FALLBACK) return primary;
  const fallback = await runSet(fallbackProviders, query, gate);
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
