/** Pure, Electron-agnostic provider layer (only Node fetch + process.env) so this folder can be
 * lifted into a future hosted Node/Express backend without a rewrite. */

import type { NewsCategory } from './channelProfiles';

export interface ProviderQuery {
  topic: string;
  channelId: string;
  subchannelId: string | null;
  /** The channel's news category (from channelProfile) — providers that support it narrow the query
   * to that category/section. null for topic/entity channels or unmapped providers. */
  category?: NewsCategory | null;
}

export interface ProviderArticle {
  url: string;
  title: string;
  snippet: string | null;
  source: string;
  publishedAt: string;
  imageUrl: string | null;
  /** Provider-reported section/desk (e.g. Guardian "Music", NYT "Politics") — a relevance signal
   * used only during filtering, not persisted. null when the provider doesn't report one. */
  section?: string | null;
  /** Provider-reported topic tags/keywords (e.g. Guardian tags, NYT keywords, NewsData keywords) —
   * the source's OWN labels for the story, a strong relevance signal used only during filtering, not
   * persisted. null/empty when the provider doesn't report any. */
  tags?: string[] | null;
}

export interface NewsProvider {
  id: string;
  label: string;
  isConfigured: () => boolean;
  fetchArticles: (query: ProviderQuery) => Promise<ProviderArticle[]>;
}

/** A ProviderArticle once it's known which provider actually produced it — tagged by
 * registry.ts's runProviders, since a single fetch cycle queries several providers in parallel
 * and their results get merged into one list. */
export interface FetchedArticle extends ProviderArticle {
  provider: string;
}
