import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { newsDataProvider } from './newsdata';
import { guardianProvider } from './guardian';
import { gNewsProvider } from './gnews';
import { isCoolingDown } from './cooldown';

export const providers: NewsProvider[] = [newsDataProvider, guardianProvider, gNewsProvider];

export async function runProviders(query: ProviderQuery): Promise<ProviderArticle[]> {
  // No console output here even when zero providers are configured — that state is visible in
  // Settings' provider panel, and isn't something a background refresh cycle should be noisy about.
  const configured = providers.filter((p) => p.isConfigured());
  const results = await Promise.allSettled(configured.map((p) => p.fetchArticles(query)));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

export function getProviderStatus(): { id: string; label: string; configured: boolean; rateLimited: boolean }[] {
  return providers.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    rateLimited: isCoolingDown(p.id),
  }));
}
