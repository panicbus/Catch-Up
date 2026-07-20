import fs from 'fs';
import { articlesCacheFilePath } from './paths';
import { articleId, normalizeTitle, normalizeUrl } from './providers/dedupe';
import { isPaywalledDomain } from './providers/paywallDomains';
import type { ProviderArticle } from './providers/types';

export interface CachedArticle {
  id: string;
  url: string;
  title: string;
  snippet: string | null;
  source: string;
  sourceDomain: string;
  imageUrl: string | null;
  publishedAt: string;
  fetchedAt: string;
  provider: string;
  channelId: string;
  subchannelId: string | null;
  paywalled: boolean;
}

interface ChannelBucket {
  maxAgeDays: number;
  maxCount: number;
  articles: CachedArticle[];
}

interface CacheFile {
  schemaVersion: 1;
  prunedAt: string;
  byChannel: Record<string, ChannelBucket>;
}

const DEFAULT_BUCKET: Omit<ChannelBucket, 'articles'> = { maxAgeDays: 14, maxCount: 300 };

/** JSON-file-backed cache of fetched articles, capped/pruned per channel by age then count.
 * Kept separate from dataStore's small user-content file so frequent background-refresh writes
 * never risk the durable channels/bookmarks/settings file. */
export class ArticlesCache {
  private data: CacheFile;
  private readonly filePath: string;

  constructor() {
    this.filePath = articlesCacheFilePath();
    this.data = this.read();
  }

  private read(): CacheFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as CacheFile;
    } catch {
      return { schemaVersion: 1, prunedAt: new Date().toISOString(), byChannel: {} };
    }
  }

  private write(): void {
    this.data.prunedAt = new Date().toISOString();
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  getArticles(channelId: string, subchannelId?: string | null, limit = 100): CachedArticle[] {
    const bucket = this.data.byChannel[channelId];
    if (!bucket) return [];
    const filtered = subchannelId
      ? bucket.articles.filter((a) => a.subchannelId === subchannelId)
      : bucket.articles;
    return [...filtered]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, limit);
  }

  /** Merges fetched provider articles into a channel's bucket, deduping by URL and by normalized
   * headline (catches wire/syndicated stories republished verbatim under different URLs across
   * outlets), and pruning by age then count. Returns the number of genuinely new articles added. */
  merge(
    channelId: string,
    subchannelId: string | null,
    provider: string,
    incoming: ProviderArticle[]
  ): number {
    const bucket = (this.data.byChannel[channelId] ??= { ...DEFAULT_BUCKET, articles: [] });
    const seenIds = new Set(bucket.articles.map((a) => a.id));
    const seenTitles = new Set(bucket.articles.map((a) => normalizeTitle(a.title)));
    let added = 0;
    for (const article of incoming) {
      const id = articleId(article.url);
      const normalizedTitle = normalizeTitle(article.title);
      if (seenIds.has(id) || seenTitles.has(normalizedTitle)) continue;
      seenIds.add(id);
      seenTitles.add(normalizedTitle);
      let hostname = '';
      try {
        hostname = new URL(normalizeUrl(article.url)).hostname;
      } catch {
        /* malformed URL — leave hostname blank, still store the article */
      }
      bucket.articles.push({
        id,
        url: article.url,
        title: article.title,
        snippet: article.snippet,
        source: article.source,
        sourceDomain: hostname,
        imageUrl: article.imageUrl,
        publishedAt: article.publishedAt,
        fetchedAt: new Date().toISOString(),
        provider,
        channelId,
        subchannelId,
        paywalled: isPaywalledDomain(hostname),
      });
      added++;
    }
    this.prune(bucket);
    this.write();
    return added;
  }

  private prune(bucket: ChannelBucket): void {
    const cutoff = Date.now() - bucket.maxAgeDays * 24 * 60 * 60 * 1000;
    const seenTitles = new Set<string>();
    bucket.articles = bucket.articles
      .filter((a) => new Date(a.publishedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      // Collapses any title duplicates already sitting in the cache from before dedupe existed —
      // sorted newest-first above, so this keeps the most recent republication of each story.
      .filter((a) => {
        const key = normalizeTitle(a.title);
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
      })
      .slice(0, bucket.maxCount);
  }

  deleteChannel(channelId: string): void {
    delete this.data.byChannel[channelId];
    this.write();
  }

  /** Picks one article at random across every channel's bucket, excluding the given ids
   * (e.g. already-read articles, or the currently-shown one for "shuffle again"). */
  getRandomArticle(excludeIds: Set<string>): CachedArticle | undefined {
    const candidates = Object.values(this.data.byChannel)
      .flatMap((bucket) => bucket.articles)
      .filter((a) => !excludeIds.has(a.id));
    if (candidates.length === 0) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
