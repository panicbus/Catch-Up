/** Database-backed replacement for main/articlesCache.ts. Same dedup/prune rules, same "genuinely
 * new to read" return-count contract for merge() — see that file's comments for the reasoning
 * behind each rule; this only changes WHERE the data lives, not what the rules are. Caps
 * (maxCount/unread/Google-News-RSS) apply per CHANNEL across all its subchannels combined, exactly
 * as the original bucketed-by-channel-only design did — a subchannel is a filter on articles
 * within a channel's pool, not its own separate pool. */

import { prisma } from '../db';
import { articleId, normalizeUrl, titleDedupeKey } from '../../main/providers/dedupe';
import { isPaywalledDomain } from '../../main/providers/paywallDomains';
import type { FetchedArticle } from '../../main/providers/types';
import { Prisma } from '../generated/prisma/client';
import type { Article as PrismaArticle } from '../generated/prisma/client';
import type { Article } from '../../ipc-contract';

const MAX_AGE_DAYS = 14;
const MAX_COUNT = 300;
const MAX_UNREAD_PER_CHANNEL = 100;
const MAX_GOOGLE_NEWS_RSS_PER_CHANNEL = 15;
const GOOGLE_NEWS_RSS_PROVIDER_ID = 'googlenewsrss';
// Same reasoning as the Google-News-RSS cap just above, generalized: a user's own custom sources
// (server/customSources/) are tagged `custom:<sourceId>`, and this caps ALL of them combined per
// channel, not per individual source — one very prolific feed (or several modest ones together)
// shouldn't be able to dominate a channel's list any more than the RSS fallback can.
const MAX_CUSTOM_SOURCE_ARTICLES_PER_CHANNEL = 20;
const CUSTOM_SOURCE_PROVIDER_PREFIX = 'custom:';

/** Exactly the columns toArticle() below reads — deliberately NOT the whole row. Notably excludes
 * `titleDedupeKey` (internal to prune's fuzzy collapse) and `userId` (the caller already knows it),
 * neither of which is ever sent to a client. Shared by every read path so they can't drift. */
const ARTICLE_SELECT = {
  id: true,
  url: true,
  title: true,
  snippet: true,
  source: true,
  sourceDomain: true,
  imageUrl: true,
  publishedAt: true,
  fetchedAt: true,
  provider: true,
  channelId: true,
  subchannelId: true,
  paywalled: true,
} as const;

/** The narrowed row shape ARTICLE_SELECT produces. Typed off PrismaArticle rather than restated, so
 * a schema change still flows through and typecheck catches any mismatch. */
type SelectedArticle = Pick<PrismaArticle, keyof typeof ARTICLE_SELECT>;

function toArticle(a: SelectedArticle, read: boolean, bookmarked: boolean): Article {
  return {
    id: a.id,
    url: a.url,
    title: a.title,
    snippet: a.snippet,
    source: a.source,
    sourceDomain: a.sourceDomain,
    imageUrl: a.imageUrl,
    publishedAt: a.publishedAt.toISOString(),
    fetchedAt: a.fetchedAt.toISOString(),
    provider: a.provider,
    channelId: a.channelId,
    subchannelId: a.subchannelId,
    paywalled: a.paywalled,
    bookmarked,
    read,
  };
}

export async function getArticles(
  userId: string,
  channelId: string,
  subchannelId?: string | null,
  limit = 300
): Promise<Article[]> {
  const rows = await prisma.article.findMany({
    where: { userId, channelId, ...(subchannelId ? { subchannelId } : {}) },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: ARTICLE_SELECT,
  });
  // Scoped to the articles actually being returned. Previously both of these pulled the user's
  // ENTIRE read-state and bookmark tables on every call — and this endpoint is hit several times
  // per 20-second poll tick, per channel. That made each call cost O(the user's whole history)
  // instead of O(one page of one channel).
  const ids = rows.map((r) => r.id);
  const [readIds, bookmarkedIds] = await Promise.all([
    prisma.readState.findMany({ where: { userId, articleId: { in: ids } }, select: { articleId: true } }),
    prisma.bookmark.findMany({ where: { userId, articleId: { in: ids } }, select: { articleId: true } }),
  ]);
  const read = new Set(readIds.map((r) => r.articleId));
  const bookmarked = new Set(bookmarkedIds.map((b) => b.articleId));
  return rows.map((a) => toArticle(a, read.has(a.id), bookmarked.has(a.id)));
}

export async function getArticleById(userId: string, channelId: string, id: string): Promise<PrismaArticle | null> {
  return prisma.article.findFirst({ where: { id, userId, channelId } });
}

/** The Pool's read path: a slice of several channels in ONE query, instead of the one-request-per-
 * channel fan-out it used to do. `limit` is applied globally (newest-first across all the channels
 * combined) rather than per channel — which is what a chronological cross-channel pool wants
 * anyway, and avoids a busy channel being trimmed to the same count as a quiet one. */
export async function getArticlesForChannels(
  userId: string,
  channelIds: string[],
  limit = 300
): Promise<Article[]> {
  if (channelIds.length === 0) return [];
  const rows = await prisma.article.findMany({
    where: { userId, channelId: { in: channelIds } },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: ARTICLE_SELECT,
  });
  const ids = rows.map((r) => r.id);
  const [readIds, bookmarkedIds] = await Promise.all([
    prisma.readState.findMany({ where: { userId, articleId: { in: ids } }, select: { articleId: true } }),
    prisma.bookmark.findMany({ where: { userId, articleId: { in: ids } }, select: { articleId: true } }),
  ]);
  const read = new Set(readIds.map((r) => r.articleId));
  const bookmarked = new Set(bookmarkedIds.map((b) => b.articleId));
  return rows.map((a) => toArticle(a, read.has(a.id), bookmarked.has(a.id)));
}

export interface ChannelCounts {
  /** Unread stories in the channel — "stories to catch up on". */
  unread: number;
  /** Of the unread, how many published in the last 24h — drives the "new" freshness tag. */
  recent: number;
}

/** Per-channel unread/recent counts for the home tiles, computed in the DATABASE.
 *
 * This exists because the home screen previously fetched every article of every channel — full
 * rows, one request per channel, every 20-second poll tick — purely to call `.length` on the
 * result and count how many were under 24h old. With nine channels that was megabytes of transfer
 * per tick to produce eighteen small integers, and it was the largest remaining consumer after the
 * refresh job was fixed (see the 2026-08-05 outage). Two aggregate rows replace all of it.
 *
 * Raw SQL because this is an anti-join (articles with NO matching read-state row), which Prisma's
 * `groupBy` can't express. The join is on `(user_id, article_id)` with no channel component, which
 * is correct and deliberate: ReadState's key is `(userId, articleId)` while Article's is
 * `(channelId, id)`, so one story appearing in two channels shares a single read-state row and
 * reads as read in both — matching what getArticles already does with its global read Set.
 *
 * The 24h window matches src/utils/isNew.ts exactly; if that changes, change this too. */
export async function getChannelCounts(userId: string): Promise<Record<string, ChannelCounts>> {
  const rows = await prisma.$queryRaw<{ channel_id: string; unread: bigint; recent: bigint }[]>`
    SELECT a.channel_id,
           COUNT(*) FILTER (WHERE r.article_id IS NULL) AS unread,
           COUNT(*) FILTER (WHERE r.article_id IS NULL
                              AND a.published_at > now() - interval '24 hours') AS recent
      FROM articles a
      LEFT JOIN read_state r
        ON r.user_id = a.user_id AND r.article_id = a.id
     WHERE a.user_id = ${userId}
     GROUP BY a.channel_id
  `;
  const counts: Record<string, ChannelCounts> = {};
  // COUNT() comes back as bigint over the wire; Number() is safe at these magnitudes (a channel is
  // capped at MAX_COUNT rows) and keeps the JSON response plain numbers rather than BigInt, which
  // JSON.stringify refuses to serialize at all.
  for (const r of rows) counts[r.channel_id] = { unread: Number(r.unread), recent: Number(r.recent) };
  return counts;
}

/** Merges freshly-fetched provider articles into a channel's pool, deduping by id and by a
 * fuzzy title key, then re-applies every prune rule. Returns the count of stories genuinely NEW
 * TO READ — added this merge, still present after pruning, and not already read (same narrower-
 * than-"rows inserted" contract as the original; see its comment for why). */
export async function merge(
  userId: string,
  channelId: string,
  subchannelId: string | null,
  incoming: FetchedArticle[]
): Promise<number> {
  const existing = await prisma.article.findMany({
    where: { userId, channelId },
    select: { id: true, titleDedupeKey: true },
  });
  const seenIds = new Set(existing.map((a) => a.id));
  const seenKeys = new Set(existing.map((a) => a.titleDedupeKey));

  const toCreate: Prisma.ArticleCreateManyInput[] = [];
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
    toCreate.push({
      id,
      userId,
      channelId,
      subchannelId,
      url: article.url,
      title: article.title,
      snippet: article.snippet,
      source: article.source,
      sourceDomain: hostname,
      imageUrl: article.imageUrl,
      publishedAt: new Date(article.publishedAt),
      fetchedAt: new Date(),
      provider: article.provider,
      paywalled: isPaywalledDomain(hostname),
      titleDedupeKey: dedupeKey,
    });
    addedIds.push(id);
  }
  if (toCreate.length > 0) {
    await prisma.article.createMany({ data: toCreate, skipDuplicates: true });
  }

  const survivingIds = await prune(userId, channelId);
  const readRows = await prisma.readState.findMany({
    where: { userId, articleId: { in: addedIds } },
    select: { articleId: true },
  });
  const read = new Set(readRows.map((r) => r.articleId));
  return addedIds.filter((id) => survivingIds.has(id) && !read.has(id)).length;
}

/** Age cutoff, fuzzy-title collapse, the unread cap, the max-count cap, and the Google-News-RSS
 * share cap — same order and same rules as main/articlesCache.ts's prune(). Returns the set of
 * article ids that survived, so merge() can compute its "genuinely new" count without a second
 * round-trip. */
async function prune(userId: string, channelId: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  // `select` is load-bearing, not tidiness: this used to fetch every column (title, snippet, url,
  // imageUrl…) of up to MAX_COUNT rows, and prune() runs once per refresh TARGET — channel plus its
  // staggered subchannels — on every cron cycle. Together with the unscoped read-state pull below
  // it was the single largest consumer of the database's data-transfer quota, which it eventually
  // exhausted entirely (2026-08-05 outage). The four fields here are exactly what the rules below
  // use: `titleDedupeKey` (fuzzy collapse), `id` (read lookup + delete set), `provider` (the
  // Google-News-RSS share cap), `publishedAt` (its sort). Adding a rule that needs a fifth field
  // means adding it here too — a missing one fails as silently-wrong pruning, not a crash.
  const rows = await prisma.article.findMany({
    where: { userId, channelId, publishedAt: { gte: cutoff } },
    orderBy: { publishedAt: 'desc' },
    select: { id: true, titleDedupeKey: true, provider: true, publishedAt: true },
  });
  // Scoped to just these articles rather than the user's entire read-state history. Sequential
  // rather than the previous Promise.all because it now depends on `rows` — irrelevant here, this
  // only ever runs on the background refresh path.
  const readRows = await prisma.readState.findMany({
    where: { userId, articleId: { in: rows.map((r) => r.id) } },
    select: { articleId: true },
  });
  const readIds = new Set(readRows.map((r) => r.articleId));

  const seenKeys = new Set<string>();
  let deduped = rows.filter((a) => {
    if (seenKeys.has(a.titleDedupeKey)) return false;
    seenKeys.add(a.titleDedupeKey);
    return true;
  });

  let unreadKept = 0;
  deduped = deduped.filter((a) => {
    if (readIds.has(a.id)) return true;
    unreadKept += 1;
    return unreadKept <= MAX_UNREAD_PER_CHANNEL;
  });

  deduped = deduped.slice(0, MAX_COUNT);

  const rss = deduped.filter((a) => a.provider === GOOGLE_NEWS_RSS_PROVIDER_ID);
  if (rss.length > MAX_GOOGLE_NEWS_RSS_PER_CHANNEL) {
    const rssKeepIds = new Set(
      [...rss]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, MAX_GOOGLE_NEWS_RSS_PER_CHANNEL)
        .map((a) => a.id)
    );
    deduped = deduped.filter((a) => a.provider !== GOOGLE_NEWS_RSS_PROVIDER_ID || rssKeepIds.has(a.id));
  }

  const custom = deduped.filter((a) => a.provider.startsWith(CUSTOM_SOURCE_PROVIDER_PREFIX));
  if (custom.length > MAX_CUSTOM_SOURCE_ARTICLES_PER_CHANNEL) {
    const customKeepIds = new Set(
      [...custom]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, MAX_CUSTOM_SOURCE_ARTICLES_PER_CHANNEL)
        .map((a) => a.id)
    );
    deduped = deduped.filter((a) => !a.provider.startsWith(CUSTOM_SOURCE_PROVIDER_PREFIX) || customKeepIds.has(a.id));
  }

  const survivingIds = new Set(deduped.map((a) => a.id));
  const allIds = new Set(rows.map((a) => a.id)); // rows already excludes anything past the age cutoff
  const toDeleteFromWindow = [...allIds].filter((id) => !survivingIds.has(id));
  // Anything outside the age cutoff entirely (not in `rows` at all) must also go.
  await prisma.article.deleteMany({
    where: {
      userId,
      channelId,
      OR: [{ publishedAt: { lt: cutoff } }, { id: { in: toDeleteFromWindow } }],
    },
  });

  return survivingIds;
}

export async function deleteChannelArticles(userId: string, channelId: string): Promise<void> {
  // Normally redundant — deleting a Channel row cascades its articles automatically — but kept as
  // its own operation for the one caller (a manual "clear channel" action) that removes articles
  // without deleting the channel itself.
  await prisma.article.deleteMany({ where: { userId, channelId } });
}

export async function getRandomArticle(
  userId: string,
  excludeIds: Set<string>,
  channelIds?: string[] | null
): Promise<Article | null> {
  const where = {
    userId,
    ...(channelIds && channelIds.length > 0 ? { channelId: { in: channelIds } } : {}),
    id: { notIn: [...excludeIds] },
  };
  // Count-then-offset instead of loading every candidate row and picking one in JS. The old version
  // pulled EVERY article the user owns (all columns, no limit) plus their entire read-state and
  // bookmark tables — well over a megabyte of database transfer to return a single story. Two
  // queries at a few hundred bytes each do the same job.
  //
  // Both run in ONE repeatable-read transaction, and the findMany has an explicit orderBy — Postgres
  // gives no ordering guarantee for skip/take without one, so without both of these a `skip` derived
  // from `count` isn't guaranteed to line up with the same query run a moment later (a concurrent
  // insert from the scheduled refresh, or simply a different query plan, could shift what's at a
  // given offset). Repeatable-read pins both statements to one consistent snapshot, closing that gap
  // entirely rather than just the delete case the id ordering alone would leave open.
  const pick = await prisma.$transaction(
    async (tx) => {
      const total = await tx.article.count({ where });
      if (total === 0) return null;
      const [row] = await tx.article.findMany({
        where,
        select: ARTICLE_SELECT,
        orderBy: { id: 'asc' },
        skip: Math.floor(Math.random() * total),
        take: 1,
      });
      return row ?? null;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
  if (!pick) return null;
  // Two point lookups on the one article we actually picked, rather than both tables in full.
  const [readRow, bookmarkRow] = await Promise.all([
    prisma.readState.findUnique({ where: { userId_articleId: { userId, articleId: pick.id } } }),
    prisma.bookmark.findUnique({ where: { userId_articleId: { userId, articleId: pick.id } } }),
  ]);
  return toArticle(pick, !!readRow, !!bookmarkRow);
}
