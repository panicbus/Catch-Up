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

function toArticle(a: PrismaArticle, read: boolean, bookmarked: boolean): Article {
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
  const [rows, readIds, bookmarkedIds] = await Promise.all([
    prisma.article.findMany({
      where: { userId, channelId, ...(subchannelId ? { subchannelId } : {}) },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    }),
    prisma.readState.findMany({ where: { userId }, select: { articleId: true } }),
    prisma.bookmark.findMany({ where: { userId }, select: { articleId: true } }),
  ]);
  const read = new Set(readIds.map((r) => r.articleId));
  const bookmarked = new Set(bookmarkedIds.map((b) => b.articleId));
  return rows.map((a) => toArticle(a, read.has(a.id), bookmarked.has(a.id)));
}

export async function getArticleById(userId: string, channelId: string, id: string): Promise<PrismaArticle | null> {
  return prisma.article.findFirst({ where: { id, userId, channelId } });
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
  const [rows, readRows] = await Promise.all([
    prisma.article.findMany({
      where: { userId, channelId, publishedAt: { gte: cutoff } },
      orderBy: { publishedAt: 'desc' },
    }),
    prisma.readState.findMany({ where: { userId }, select: { articleId: true } }),
  ]);
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
  const [rows, readIds, bookmarkedIds] = await Promise.all([
    prisma.article.findMany({
      where: {
        userId,
        ...(channelIds && channelIds.length > 0 ? { channelId: { in: channelIds } } : {}),
        id: { notIn: [...excludeIds] },
      },
    }),
    prisma.readState.findMany({ where: { userId }, select: { articleId: true } }),
    prisma.bookmark.findMany({ where: { userId }, select: { articleId: true } }),
  ]);
  if (rows.length === 0) return null;
  const pick = rows[Math.floor(Math.random() * rows.length)];
  const read = new Set(readIds.map((r) => r.articleId));
  const bookmarked = new Set(bookmarkedIds.map((b) => b.articleId));
  return toArticle(pick, read.has(pick.id), bookmarked.has(pick.id));
}
