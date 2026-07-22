/** Pure, Electron-agnostic provider layer (only Node fetch + process.env) so this folder can be
 * lifted into a future hosted Node/Express backend without a rewrite. */

export interface ProviderQuery {
  topic: string;
  channelId: string;
  subchannelId: string | null;
}

export interface ProviderArticle {
  url: string;
  title: string;
  snippet: string | null;
  source: string;
  publishedAt: string;
  imageUrl: string | null;
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
