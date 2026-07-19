import type { NewsProvider, ProviderArticle, ProviderQuery } from './types';
import { newsDataProvider } from './newsdata';
import { guardianProvider } from './guardian';
import { gNewsProvider } from './gnews';

export const providers: NewsProvider[] = [newsDataProvider, guardianProvider, gNewsProvider];

export async function runProviders(query: ProviderQuery): Promise<ProviderArticle[]> {
  const configured = providers.filter((p) => p.isConfigured());
  if (configured.length === 0) {
    console.warn('[providers] no provider API keys configured — no articles will be fetched');
  }
  const results = await Promise.allSettled(configured.map((p) => p.fetchArticles(query)));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

export function getProviderStatus(): { id: string; label: string; configured: boolean }[] {
  return providers.map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() }));
}
