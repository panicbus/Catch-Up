import type { FetchedArticle, NewsProvider, ProviderQuery } from './types';
import { newsDataProvider } from './newsdata';
import { guardianProvider } from './guardian';
import { gNewsProvider } from './gnews';
import { isCoolingDown } from './cooldown';

export const providers: NewsProvider[] = [newsDataProvider, guardianProvider, gNewsProvider];

export async function runProviders(query: ProviderQuery): Promise<FetchedArticle[]> {
  // No console output here even when zero providers are configured — that state is visible in
  // Settings' provider panel, and isn't something a background refresh cycle should be noisy about.
  const configured = providers.filter((p) => p.isConfigured());
  const results = await Promise.allSettled(configured.map((p) => p.fetchArticles(query)));
  // Promise.allSettled preserves input order, so results[i] always corresponds to configured[i] —
  // tagging each provider's own results here (rather than after everything's flattened together)
  // is what lets a fetched article ever record its real source instead of a generic placeholder.
  return results.flatMap((r, i) =>
    r.status === 'fulfilled' ? r.value.map((a) => ({ ...a, provider: configured[i].id })) : []
  );
}

export function getProviderStatus(): { id: string; label: string; configured: boolean; rateLimited: boolean }[] {
  return providers.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    rateLimited: isCoolingDown(p.id),
  }));
}
