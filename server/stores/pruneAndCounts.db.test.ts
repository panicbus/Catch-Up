/** Protects the query-narrowing work from the 2026-08-05 outage recovery: prune(), getRandomArticle,
 * getChannelCounts, and getArticlesForChannels all moved from "fetch every column / the whole
 * read-state table" to selecting only the fields each rule actually uses. That's exactly the kind of
 * change that can pass every existing test while silently breaking in production — a forgotten
 * field in a `select` doesn't throw, it just makes the logic downstream of it wrong. These tests
 * exercise each selected field's actual behavior, not just "the call doesn't throw."
 *
 * Run with `npm run test:db` (needs DATABASE_URL). Kept out of the default `npm test`. */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../db';
import * as dataStore from './dataStore';
import * as articlesCache from './articlesCache';
import type { FetchedArticle } from '../../main/providers/types';

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL = `prune-counts-${SUFFIX}@example.test`;

let userId = '';

function story(overrides: Partial<FetchedArticle> & { url: string; title: string }): FetchedArticle {
  return {
    snippet: null,
    source: 'Example',
    imageUrl: null,
    provider: 'guardian',
    publishedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: EMAIL } });
  userId = user.id;
  await prisma.settings.create({ data: { userId } });
  await prisma.streak.create({ data: { userId } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe('prune() with a narrowed column selection', () => {
  it('still enforces the per-channel unread cap (needs `id`)', async () => {
    const channelId = (await dataStore.createChannel(userId, 'Unread Cap Channel')).id;
    // MAX_UNREAD_PER_CHANNEL is 100 (articlesCache.ts) — 105 unique unread stories, one merge call.
    const incoming = Array.from({ length: 105 }, (_, i) =>
      story({ url: `https://example.test/unread-cap-${i}`, title: `Unread cap story ${i}` })
    );
    await articlesCache.merge(userId, channelId, null, incoming);
    const surviving = await articlesCache.getArticles(userId, channelId, null, 999);
    expect(surviving.length).toBe(100);
  });

  it('still enforces the Google-News-RSS per-channel share cap (needs `provider` and `publishedAt`)', async () => {
    const channelId = (await dataStore.createChannel(userId, 'RSS Cap Channel')).id;
    // MAX_GOOGLE_NEWS_RSS_PER_CHANNEL is 15 — 20 RSS stories with distinct, staggered timestamps so
    // "keep the newest 15" is a real assertion, not a coincidence of insertion order.
    const incoming = Array.from({ length: 20 }, (_, i) =>
      story({
        url: `https://example.test/rss-cap-${i}`,
        title: `RSS cap story ${i}`,
        provider: 'googlenewsrss',
        publishedAt: new Date(Date.now() - i * 60_000).toISOString(), // i=0 is newest
      })
    );
    await articlesCache.merge(userId, channelId, null, incoming);
    const surviving = await articlesCache.getArticles(userId, channelId, null, 999);
    expect(surviving.length).toBe(15);
    // The 15 that survived must be the 15 NEWEST (i = 0..14), not an arbitrary 15 — this is only
    // true if `publishedAt` came back from the selected query and the local sort actually ran on it.
    const survivingUrls = new Set(surviving.map((a) => a.url));
    for (let i = 0; i < 15; i++) expect(survivingUrls.has(`https://example.test/rss-cap-${i}`)).toBe(true);
    for (let i = 15; i < 20; i++) expect(survivingUrls.has(`https://example.test/rss-cap-${i}`)).toBe(false);
  });

  it('still deletes articles past the age cutoff (the WHERE clause, unaffected by select, but worth locking in alongside the above)', async () => {
    const channelId = (await dataStore.createChannel(userId, 'Age Cutoff Channel')).id;
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days — past MAX_AGE_DAYS (14)
    await articlesCache.merge(userId, channelId, null, [
      story({ url: 'https://example.test/too-old', title: 'An old story', publishedAt: old }),
      story({ url: 'https://example.test/fresh', title: 'A fresh story' }),
    ]);
    const surviving = await articlesCache.getArticles(userId, channelId, null, 999);
    expect(surviving.map((a) => a.url)).toEqual(['https://example.test/fresh']);
  });

  it('collapses a fuzzy-title duplicate created by a concurrent-merge race (needs `titleDedupeKey`)', async () => {
    const channelId = (await dataStore.createChannel(userId, 'Race Collapse Channel')).id;
    // merge() itself already prevents inserting a duplicate dedupe key against rows that exist
    // BEFORE it starts — but two merge() calls for the same channel firing concurrently (e.g. a
    // user-triggered refresh landing mid-cron-cycle) can each read the pre-insert snapshot before
    // either has written, and both insert an article with the same title. prune()'s own fuzzy-title
    // collapse — re-scanning every row in the channel and keeping only the newest per dedupe key —
    // is the safety net for exactly that race, and it depends on `titleDedupeKey` surviving the
    // select narrowing.
    const title = 'The exact same headline both racing merges will report';
    await Promise.all([
      articlesCache.merge(userId, channelId, null, [story({ url: 'https://example.test/race-a', title })]),
      articlesCache.merge(userId, channelId, null, [story({ url: 'https://example.test/race-b', title })]),
    ]);
    const surviving = await articlesCache.getArticles(userId, channelId, null, 999);
    expect(surviving.length).toBe(1);
  });
});

describe('getRandomArticle after adding a deterministic order + transaction', () => {
  it('still only ever returns an article that actually exists and is unread-eligible', async () => {
    const channelId = (await dataStore.createChannel(userId, 'Random Pick Channel')).id;
    await articlesCache.merge(userId, channelId, null, [
      story({ url: 'https://example.test/pickable-1', title: 'Pickable one' }),
      story({ url: 'https://example.test/pickable-2', title: 'Pickable two' }),
    ]);
    // Scoped to this one channel — getRandomArticle is scoped by user, not channel, by default, and
    // this user already has hundreds of articles from the earlier tests in this file.
    const picked = await articlesCache.getRandomArticle(userId, new Set(), [channelId]);
    expect(picked).not.toBeNull();
    expect(picked!.channelId).toBe(channelId);
  });

  it('never picks an id in the exclude set', async () => {
    const channelId = (await dataStore.createChannel(userId, 'Random Exclude Channel')).id;
    await articlesCache.merge(userId, channelId, null, [
      story({ url: 'https://example.test/exclude-me', title: 'Excluded story' }),
    ]);
    const [only] = await articlesCache.getArticles(userId, channelId);
    // Scoped to this one channel, same reason as above — otherwise the exclude set would need to
    // cover every article the user has ever had merged in this test run to force a null result.
    const picked = await articlesCache.getRandomArticle(userId, new Set([only.id]), [channelId]);
    expect(picked).toBeNull();
  });
});

describe('getChannelCounts()', () => {
  it('counts unread and recent correctly for a single channel', async () => {
    const channelId = (await dataStore.createChannel(userId, 'Counts Channel')).id;
    await articlesCache.merge(userId, channelId, null, [
      story({ url: 'https://example.test/counts-recent-unread', title: 'Recent unread', publishedAt: new Date().toISOString() }),
      story({
        url: 'https://example.test/counts-old-unread',
        title: 'Old unread',
        publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      story({ url: 'https://example.test/counts-read', title: 'Already read' }),
    ]);
    // Find the "already read" one by url rather than assuming an order, and mark it read.
    const all = await articlesCache.getArticles(userId, channelId, null, 999);
    const toRead = all.find((a) => a.url === 'https://example.test/counts-read')!;
    await dataStore.markRead(userId, toRead.id);

    const counts = await articlesCache.getChannelCounts(userId);
    expect(counts[channelId]).toEqual({ unread: 2, recent: 1 });
  });

  it('reflects a read state change in BOTH channels when a story lives in two (matches getArticles\' global read Set)', async () => {
    const channelA = (await dataStore.createChannel(userId, 'Counts Cross A')).id;
    const channelB = (await dataStore.createChannel(userId, 'Counts Cross B')).id;
    const shared = story({ url: 'https://example.test/counts-shared-story', title: 'Shared across two channels' });
    await articlesCache.merge(userId, channelA, null, [shared]);
    await articlesCache.merge(userId, channelB, null, [shared]);

    let counts = await articlesCache.getChannelCounts(userId);
    expect(counts[channelA]?.unread).toBe(1);
    expect(counts[channelB]?.unread).toBe(1);

    const [inA] = await articlesCache.getArticles(userId, channelA);
    await dataStore.markRead(userId, inA.id);

    counts = await articlesCache.getChannelCounts(userId);
    // Same article id, same user — the LEFT JOIN is keyed on (user_id, article_id) with no channel
    // component, so marking it read via channel A must also zero out channel B's unread count.
    expect(counts[channelA]?.unread).toBe(0);
    expect(counts[channelB]?.unread).toBe(0);
  });

  it('omits a channel that has no articles at all, rather than returning a zeroed entry', async () => {
    const channelId = (await dataStore.createChannel(userId, 'Empty Counts Channel')).id;
    const counts = await articlesCache.getChannelCounts(userId);
    expect(counts[channelId]).toBeUndefined();
  });

  it('agrees with getArticles\' own unread computation for the same data (the two must never drift)', async () => {
    // getChannelCounts is a separate raw-SQL path from getArticles' JS-side `.filter(a => !a.read)`.
    // Nothing enforces they stay in sync except a test like this one — if either is edited alone in
    // the future, this is what catches the drift.
    const channelId = (await dataStore.createChannel(userId, 'Agreement Channel')).id;
    await articlesCache.merge(userId, channelId, null, [
      story({ url: 'https://example.test/agree-1', title: 'Agreement story one' }),
      story({ url: 'https://example.test/agree-2', title: 'Agreement story two' }),
      story({ url: 'https://example.test/agree-3', title: 'Agreement story three' }),
    ]);
    const all = await articlesCache.getArticles(userId, channelId, null, 999);
    await dataStore.markRead(userId, all.find((a) => a.url === 'https://example.test/agree-2')!.id);

    const viaGetArticles = (await articlesCache.getArticles(userId, channelId, null, 999)).filter((a) => !a.read).length;
    const viaGetChannelCounts = (await articlesCache.getChannelCounts(userId))[channelId]?.unread;
    expect(viaGetChannelCounts).toBe(viaGetArticles);
    expect(viaGetChannelCounts).toBe(2);
  });
});

describe('getArticlesForChannels()', () => {
  it('returns the union of several channels sorted newest-first', async () => {
    const channelA = (await dataStore.createChannel(userId, 'Pool Merge A')).id;
    const channelB = (await dataStore.createChannel(userId, 'Pool Merge B')).id;
    await articlesCache.merge(userId, channelA, null, [
      story({ url: 'https://example.test/pool-a-old', title: 'Pool A older', publishedAt: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    await articlesCache.merge(userId, channelB, null, [
      story({ url: 'https://example.test/pool-b-new', title: 'Pool B newer', publishedAt: new Date().toISOString() }),
    ]);
    const merged = await articlesCache.getArticlesForChannels(userId, [channelA, channelB]);
    expect(merged.map((a) => a.url)).toEqual(['https://example.test/pool-b-new', 'https://example.test/pool-a-old']);
  });

  it('applies the limit globally across channels, not per channel', async () => {
    const channelA = (await dataStore.createChannel(userId, 'Pool Limit A')).id;
    const channelB = (await dataStore.createChannel(userId, 'Pool Limit B')).id;
    await articlesCache.merge(userId, channelA, null, [
      story({ url: 'https://example.test/pool-limit-a1', title: 'Limit A1' }),
      story({ url: 'https://example.test/pool-limit-a2', title: 'Limit A2' }),
    ]);
    await articlesCache.merge(userId, channelB, null, [
      story({ url: 'https://example.test/pool-limit-b1', title: 'Limit B1' }),
      story({ url: 'https://example.test/pool-limit-b2', title: 'Limit B2' }),
    ]);
    const merged = await articlesCache.getArticlesForChannels(userId, [channelA, channelB], 3);
    expect(merged.length).toBe(3);
  });

  it('returns an empty list for an empty channel list rather than querying the whole account', async () => {
    expect(await articlesCache.getArticlesForChannels(userId, [])).toEqual([]);
  });
});
