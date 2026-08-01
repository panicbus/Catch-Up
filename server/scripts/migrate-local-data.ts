/** One-time migration: reads this machine's real local data files (the desktop app's JSON
 * stores — see main/dataStore.ts and main/articlesCache.ts for their exact shapes) and inserts
 * the equivalent rows into the hosted database, under the already-seeded owner account. Run once,
 * verify counts, done — not a permanent feature. Original ids (channel/subchannel/bookmark/article)
 * are preserved exactly as they exist locally, so nothing needs remapping.
 *
 * Usage: npx tsx server/scripts/migrate-local-data.ts /path/to/catchup-data.json /path/to/articles-cache.json
 */

import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../db';
import { titleDedupeKey } from '../../main/providers/dedupe';
import { Prisma } from '../generated/prisma/client';

interface LocalChannel {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  sortOrder: number;
  subchannels: { id: string; name: string; createdAt: string }[];
  pausedUntil: string | null;
  pausedLabel: string | null;
}

interface LocalDataFile {
  onboarding: { completed: boolean; completedAt: string | null };
  settings: {
    defaultViewMode: string;
    refreshIntervalMinutes: number;
    theme: string;
    rollTheDiceChannelIds: string[] | null;
    maxStoriesShown: number;
    homeLocation: { query: string; label: string; lat: number; lon: number } | null | undefined;
  };
  ai: { enabled: boolean; apiKey: string | null };
  channels: LocalChannel[];
  bookmarks: {
    id: string;
    channelId: string;
    subchannelId: string | null;
    articleId: string;
    bookmarkedAt: string;
    articleSnapshot: unknown;
  }[];
  readArticleIds: { id: string; readAt: string }[];
  streak: { current: number; lastOpenedDate: string | null };
}

interface LocalCachedArticle {
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

interface LocalCacheFile {
  byChannel: Record<string, { articles: LocalCachedArticle[] }>;
}

async function main() {
  const [, , dataPath, cachePath] = process.argv;
  if (!dataPath || !cachePath) {
    console.error('Usage: npx tsx server/scripts/migrate-local-data.ts <catchup-data.json> <articles-cache.json>');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as LocalDataFile;
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as LocalCacheFile;

  const owner = await prisma.user.findFirst({ where: { isOwner: true } });
  if (!owner) throw new Error('No owner account exists yet — seed one before running this migration.');
  const userId = owner.id;
  console.log(`Migrating into owner account ${userId} (${owner.email})`);

  // 1. Channels + subchannels first — everything else references them.
  for (const channel of data.channels) {
    // upsert, not create — makes the whole script safe to run again (e.g. after fixing something
    // partway through a first attempt) instead of needing a manual reset every time.
    const channelData = {
      userId,
      name: channel.name,
      slug: channel.slug,
      sortOrder: channel.sortOrder,
      createdAt: new Date(channel.createdAt),
      pausedUntil: channel.pausedUntil ? new Date(channel.pausedUntil) : null,
      pausedLabel: channel.pausedLabel,
    };
    await prisma.channel.upsert({ where: { id: channel.id }, create: { id: channel.id, ...channelData }, update: channelData });
    for (const sub of channel.subchannels) {
      const subData = { channelId: channel.id, userId, name: sub.name, createdAt: new Date(sub.createdAt) };
      await prisma.subchannel.upsert({ where: { id: sub.id }, create: { id: sub.id, ...subData }, update: subData });
    }
  }
  console.log(`Created ${data.channels.length} channel(s), ${data.channels.reduce((s, c) => s + c.subchannels.length, 0)} subchannel(s)`);

  // 2. Settings + streak — rows already exist (seeded with defaults), so update rather than create.
  await prisma.settings.update({
    where: { userId },
    data: {
      defaultViewMode: data.settings.defaultViewMode,
      refreshIntervalMinutes: data.settings.refreshIntervalMinutes,
      theme: data.settings.theme,
      rollTheDiceChannelIds: data.settings.rollTheDiceChannelIds ?? [],
      maxStoriesShown: data.settings.maxStoriesShown,
      homeLocation: data.settings.homeLocation ? (data.settings.homeLocation as object) : Prisma.DbNull,
      aiEnabled: data.ai.enabled,
      aiApiKey: data.ai.apiKey,
      onboardingCompleted: data.onboarding.completed,
      onboardingCompletedAt: data.onboarding.completedAt ? new Date(data.onboarding.completedAt) : null,
    },
  });
  await prisma.streak.update({
    where: { userId },
    data: {
      current: data.streak.current,
      lastCaughtUpDate: data.streak.lastOpenedDate ? new Date(data.streak.lastOpenedDate) : null,
    },
  });
  console.log('Updated settings and streak');

  // 3. Bookmarks.
  if (data.bookmarks.length > 0) {
    await prisma.bookmark.createMany({
      skipDuplicates: true,
      data: data.bookmarks.map((b) => ({
        id: b.id,
        userId,
        channelId: b.channelId,
        subchannelId: b.subchannelId,
        articleId: b.articleId,
        bookmarkedAt: new Date(b.bookmarkedAt),
        articleSnapshot: b.articleSnapshot as Prisma.InputJsonValue,
      })),
    });
  }
  console.log(`Created ${data.bookmarks.length} bookmark(s)`);

  // 4. Read state.
  if (data.readArticleIds.length > 0) {
    await prisma.readState.createMany({
      data: data.readArticleIds.map((r) => ({ userId, articleId: r.id, readAt: new Date(r.readAt) })),
      skipDuplicates: true,
    });
  }
  console.log(`Created ${data.readArticleIds.length} read-state entr${data.readArticleIds.length === 1 ? 'y' : 'ies'}`);

  // 5. Articles — computed titleDedupeKey wasn't stored in the old cache format, so recompute it.
  // The old app never cleaned up articles' subchannelId when a subchannel was later deleted (only
  // the desktop app's own settings/bookmarks referencing it were cleared) — the new database
  // enforces a real foreign key here, so an orphaned reference is nulled out instead of rejected,
  // the same fallback a real deletion (onDelete: SetNull) would produce.
  const validSubchannelIds = new Set(data.channels.flatMap((c) => c.subchannels.map((s) => s.id)));
  let orphanedSubchannelRefs = 0;
  let articleCount = 0;
  for (const [channelId, bucket] of Object.entries(cache.byChannel)) {
    if (bucket.articles.length === 0) continue;
    await prisma.article.createMany({
      skipDuplicates: true,
      data: bucket.articles.map((a) => {
        const subchannelId = a.subchannelId && validSubchannelIds.has(a.subchannelId) ? a.subchannelId : null;
        if (a.subchannelId && !subchannelId) orphanedSubchannelRefs++;
        return {
          id: a.id,
          userId,
          channelId,
          subchannelId,
          url: a.url,
          title: a.title,
          snippet: a.snippet,
          source: a.source,
          sourceDomain: a.sourceDomain,
          imageUrl: a.imageUrl,
          publishedAt: new Date(a.publishedAt),
          fetchedAt: new Date(a.fetchedAt),
          provider: a.provider,
          paywalled: a.paywalled,
          titleDedupeKey: titleDedupeKey(a.title),
        };
      }),
    });
    articleCount += bucket.articles.length;
  }
  console.log(`Created ${articleCount} article(s)${orphanedSubchannelRefs > 0 ? ` (${orphanedSubchannelRefs} had a since-deleted subchannel reference, cleared to null)` : ''}`);

  await prisma.$disconnect();
  console.log('Migration complete.');
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
