import fs from 'fs';
import { articlesCacheFilePath } from './paths';
import { articleId, normalizeUrl, titleDedupeKey } from './providers/dedupe';
import { isPaywalledDomain } from './providers/paywallDomains';
import type { FetchedArticle } from './providers/types';

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

// Hard ceiling on UNREAD stories per channel so the "to catch up on" number never gets overwhelming.
// Read stories don't count against this (they live out their 10-day life in the archive — see
// READ_STATE_MAX_AGE_DAYS in dataStore.ts); when new stories arrive the freshest 100 unread are
// kept and older unread fall away. maxCount above stays as a high total-storage safety net.
const MAX_UNREAD_PER_CHANNEL = 100;

// Google News RSS is a last-resort fallback (see registry.ts) precisely because every one of its
// articles is snippet-less and image-less — a channel whose primary providers come up thin can
// otherwise end up mostly or entirely filled with it. This caps its share of any one channel
// regardless of how often the fallback fires, so it stays a minority supplement rather than
// crowding out richer sources even during a stretch where a primary provider is down or rate
// limited. Enforced on every merge (see prune), not just once — a one-time trim alone would let it
// silently creep back up over following cycles.
const MAX_GOOGLE_NEWS_RSS_PER_CHANNEL = 15;
const GOOGLE_NEWS_RSS_PROVIDER_ID = 'googlenewsrss';

/** JSON-file-backed cache of fetched articles, capped/pruned per channel by age then count.
 * Kept separate from dataStore's small user-content file so frequent background-refresh writes
 * never risk the durable channels/bookmarks/settings file. */
export class ArticlesCache {
  private data: CacheFile;
  private readonly filePath: string;
  /** Read-state lookup, supplied by main.ts from the data store (the cache doesn't own read state).
   * A live function, not a snapshot — so pruning always reflects the current read state. */
  private readonly isRead: (articleId: string) => boolean;

  constructor(isRead: (articleId: string) => boolean) {
    this.isRead = isRead;
    this.filePath = articlesCacheFilePath();
    this.data = this.read();
    this.migrateGoogleNewsRssSnippets();
    // Re-run the full prune (age, dedup, the 100-unread cap, the Google News RSS cap) over every
    // bucket on load, so channels that already overflowed in the saved file get trimmed now rather
    // than only on their next refresh.
    this.repruneAllBuckets();
  }

  /** Runs the FULL prune() (age cutoff, title dedup, the 100-unread cap, the Google News RSS cap)
   * over every bucket once on load — deliberately broader than the old Google-News-only trim it
   * replaced. This is what retro-applies a newly-tightened cap to channels that already overflowed
   * in the saved file, so they're trimmed at startup rather than only on their next refresh; from
   * then on the same prune() runs on every merge. Because it reuses the one prune(), the caps stay
   * defined in exactly one place — but note any prune() change now also takes effect at cold start,
   * before any refresh. */
  private repruneAllBuckets(): void {
    let changed = false;
    for (const bucket of Object.values(this.data.byChannel)) {
      const before = bucket.articles.length;
      this.prune(bucket);
      if (bucket.articles.length !== before) changed = true;
    }
    if (changed) this.write();
  }

  private capGoogleNewsRss(bucket: ChannelBucket): void {
    const rss = bucket.articles.filter((a) => a.provider === GOOGLE_NEWS_RSS_PROVIDER_ID);
    if (rss.length <= MAX_GOOGLE_NEWS_RSS_PER_CHANNEL) return;
    const keep = new Set(
      [...rss]
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        .slice(0, MAX_GOOGLE_NEWS_RSS_PER_CHANNEL)
        .map((a) => a.id)
    );
    bucket.articles = bucket.articles.filter((a) => a.provider !== GOOGLE_NEWS_RSS_PROVIDER_ID || keep.has(a.id));
  }

  /** One-time cleanup for googlenewsrss articles cached before that provider's snippet field
   * stopped being populated (it was never a real summary — just Google's own restated-headline
   * cluster text, redundant with the title) — new fetches already come through clean, but
   * anything merged earlier is stuck with the old value until it naturally ages out otherwise. */
  private migrateGoogleNewsRssSnippets(): void {
    let changed = false;
    for (const bucket of Object.values(this.data.byChannel)) {
      for (const article of bucket.articles) {
        if (article.provider === 'googlenewsrss' && article.snippet !== null) {
          article.snippet = null;
          changed = true;
        }
      }
    }
    if (changed) this.write();
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

  // Matches DEFAULT_BUCKET.maxCount below — the default here effectively means "everything
  // currently cached for this channel." A smaller default (previously 100) meant a channel whose
  // most recent articles happen to be a content-light source (no snippet/image) could keep older,
  // richer articles from ever reaching the renderer at all, before NewsFeed's own
  // interspersing/capping logic ever got a chance to consider them.
  getArticles(channelId: string, subchannelId?: string | null, limit = 300): CachedArticle[] {
    const bucket = this.data.byChannel[channelId];
    if (!bucket) return [];
    const filtered = subchannelId
      ? bucket.articles.filter((a) => a.subchannelId === subchannelId)
      : bucket.articles;
    return [...filtered]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, limit);
  }

  /** Direct by-id lookup within a known channel's bucket — a plain `.find()`, unlike getArticles
   * (which sorts and slices the whole bucket for display purposes the caller doesn't need here). */
  getArticleById(channelId: string, articleId: string): CachedArticle | undefined {
    return this.data.byChannel[channelId]?.articles.find((a) => a.id === articleId);
  }

  /** Merges fetched provider articles into a channel's bucket, deduping by URL and by a stopword-
   * stripped headline key (catches wire/syndicated stories republished under different URLs, plus
   * near-duplicates that differ only by a filler word), and pruning by age then count. Each incoming
   * article carries its own real originating
   * provider (tagged by runProviders) — a single call here can merge results from several providers
   * queried in parallel, so there's no one blanket provider for the whole batch.
   *
   * Returns the count of stories that are genuinely NEW TO READ — added this merge, still present
   * after the prune, and not already read. This is deliberately narrower than "rows inserted": a
   * story can be re-fetched after it aged out of the cache while its read state lingers (read ids
   * are kept longer than the cache cap for busy channels), and stale results can be pruned right
   * back out — neither is something new to show the user, so neither should be counted as "found." */
  merge(channelId: string, subchannelId: string | null, incoming: FetchedArticle[]): number {
    const bucket = (this.data.byChannel[channelId] ??= { ...DEFAULT_BUCKET, articles: [] });
    const seenIds = new Set(bucket.articles.map((a) => a.id));
    const seenKeys = new Set(bucket.articles.map((a) => titleDedupeKey(a.title)));
    const addedIds: string[] = [];
    for (const article of incoming) {
      const id = articleId(article.url);
      const dedupeKey = titleDedupeKey(article.title);
      if (seenIds.has(id) || seenKeys.has(dedupeKey)) continue;
      seenIds.add(id);
      seenKeys.add(dedupeKey);
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
        provider: article.provider,
        channelId,
        subchannelId,
        paywalled: isPaywalledDomain(hostname),
      });
      addedIds.push(id);
    }
    this.prune(bucket);
    this.write();
    const surviving = new Set(bucket.articles.map((a) => a.id));
    return addedIds.filter((id) => surviving.has(id) && !this.isRead(id)).length;
  }

  private prune(bucket: ChannelBucket): void {
    const cutoff = Date.now() - bucket.maxAgeDays * 24 * 60 * 60 * 1000;
    const seenKeys = new Set<string>();
    let unreadKept = 0;
    bucket.articles = bucket.articles
      .filter((a) => new Date(a.publishedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      // Collapses title duplicates and near-duplicates already sitting in the cache (from before the
      // fuzzy key existed) — sorted newest-first above, so this keeps the most recent of each story.
      .filter((a) => {
        const key = titleDedupeKey(a.title);
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      // Cap UNREAD to the newest MAX_UNREAD_PER_CHANNEL (list is newest-first). Read stories are
      // always kept here (they age out via the cutoff above / the archive), and are never dropped to
      // make room for unread — so the "to catch up on" number can't exceed the cap.
      .filter((a) => {
        if (this.isRead(a.id)) return true;
        unreadKept += 1;
        return unreadKept <= MAX_UNREAD_PER_CHANNEL;
      })
      .slice(0, bucket.maxCount);
    this.capGoogleNewsRss(bucket);
  }

  deleteChannel(channelId: string): void {
    delete this.data.byChannel[channelId];
    this.write();
  }

  /** Picks one article at random across every channel's bucket, excluding the given ids
   * (e.g. already-read articles, or the currently-shown one for "shuffle again"). `channelIds`
   * restricts the pool to those channels — null/undefined/empty means no restriction. */
  getRandomArticle(excludeIds: Set<string>, channelIds?: string[] | null): CachedArticle | undefined {
    const buckets =
      channelIds && channelIds.length > 0
        ? channelIds.map((id) => this.data.byChannel[id]).filter((b): b is ChannelBucket => !!b)
        : Object.values(this.data.byChannel);
    const candidates = buckets.flatMap((bucket) => bucket.articles).filter((a) => !excludeIds.has(a.id));
    if (candidates.length === 0) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
