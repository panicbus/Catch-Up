/** Proves that per-account scoping actually isolates — against a real database, with two real
 * accounts.
 *
 * WHY THIS EXISTS: every store function already takes a userId and filters on it, but until now
 * only ONE user has ever existed, so none of that filtering had ever been exercised against a
 * second account. That made the multi-account scaffolding look ready without anything verifying it
 * was. These tests create a second account holding its own channels/articles/bookmarks/read-state
 * and assert that account A's calls can neither see nor mutate account B's data.
 *
 * This is NOT a substitute for a database-level backstop (Postgres row-level security, or a query
 * layer that makes omitting the scope impossible). A forgotten `userId` in a future where-clause
 * would still leak, and only a test that happens to cover that call would catch it. That structural
 * fix belongs to the real-accounts phase; this suite is the verification floor beneath it.
 *
 * Run with `npm run test:isolation` (needs DATABASE_URL). Kept out of the default `npm test` so
 * the pre-commit hook never writes to a live database.  */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../db';
import * as dataStore from './dataStore';
import * as articlesCache from './articlesCache';
import { ServerClassificationStore } from './classificationStore';

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL_A = `isolation-a-${SUFFIX}@example.test`;
const EMAIL_B = `isolation-b-${SUFFIX}@example.test`;

let userA = '';
let userB = '';
let channelA = '';
let channelB = '';

async function seedUser(email: string): Promise<string> {
  const user = await prisma.user.create({ data: { email } });
  await prisma.settings.create({ data: { userId: user.id } });
  await prisma.streak.create({ data: { userId: user.id } });
  return user.id;
}

beforeAll(async () => {
  userA = await seedUser(EMAIL_A);
  userB = await seedUser(EMAIL_B);

  channelA = (await dataStore.createChannel(userA, 'Account A Channel')).id;
  channelB = (await dataStore.createChannel(userB, 'Account B Channel')).id;

  const now = new Date().toISOString();
  await articlesCache.merge(userA, channelA, null, [
    { url: 'https://example.test/a-1', title: 'Account A story one', snippet: null, source: 'A', publishedAt: now, imageUrl: null, provider: 'guardian' },
  ]);
  await articlesCache.merge(userB, channelB, null, [
    { url: 'https://example.test/b-1', title: 'Account B story one', snippet: null, source: 'B', publishedAt: now, imageUrl: null, provider: 'guardian' },
  ]);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
  await prisma.$disconnect();
});

describe('reads are scoped to the acting account', () => {
  it('getChannels never returns another account’s channels', async () => {
    const a = await dataStore.getChannels(userA);
    expect(a.map((c) => c.id)).toEqual([channelA]);
    const b = await dataStore.getChannels(userB);
    expect(b.map((c) => c.id)).toEqual([channelB]);
  });

  it('getArticles returns nothing when asked for another account’s channel', async () => {
    // The channel id is real and populated — but it belongs to B, so A must see an empty list
    // rather than B's stories.
    const leaked = await articlesCache.getArticles(userA, channelB);
    expect(leaked).toEqual([]);
  });

  it('getArticleById will not fetch another account’s article', async () => {
    const bArticles = await articlesCache.getArticles(userB, channelB);
    expect(bArticles.length).toBe(1);
    const leaked = await articlesCache.getArticleById(userA, channelB, bArticles[0].id);
    expect(leaked).toBeNull();
  });

  it('getRandomArticle never surfaces another account’s article', async () => {
    const picked = await articlesCache.getRandomArticle(userA, new Set());
    expect(picked?.channelId).toBe(channelA);
  });

  it('bookmarks and read state stay separate per account', async () => {
    const aArticles = await articlesCache.getArticles(userA, channelA);
    await dataStore.markRead(userA, aArticles[0].id);
    expect(await dataStore.isRead(userA, aArticles[0].id)).toBe(true);
    // Same article id, different account — must read as unread.
    expect(await dataStore.isRead(userB, aArticles[0].id)).toBe(false);

    await dataStore.toggleBookmark(userA, aArticles[0].id, channelA, {
      subchannelId: null, url: 'https://example.test/a-1', title: 'Account A story one', snippet: null,
      source: 'A', publishedAt: new Date().toISOString(), paywalled: false, imageUrl: null,
    });
    expect(Object.keys(await dataStore.getBookmarksByChannel(userA))).toEqual([channelA]);
    expect(Object.keys(await dataStore.getBookmarksByChannel(userB))).toEqual([]);
  });

  it('settings and streak are per account', async () => {
    await dataStore.setSettings(userA, { maxStoriesShown: 50 });
    expect((await dataStore.getSettings(userA)).maxStoriesShown).toBe(50);
    expect((await dataStore.getSettings(userB)).maxStoriesShown).toBe(25);
  });

  it('AI classification verdicts do not cross accounts', async () => {
    const storeA = new ServerClassificationStore(userA);
    const storeB = new ServerClassificationStore(userB);
    const key = `${channelA}:shared-article-id`;
    await storeA.recordClassifications([{ id: key, keep: true }]);
    expect((await storeA.getVerdicts([key])).get(key)).toBe(true);
    // B has its own budget and its own verdicts — A's classification must not appear or be billed.
    expect((await storeB.getVerdicts([key])).get(key)).toBeUndefined();
    expect(await storeB.remainingDailyBudget()).toBe(Number(process.env.AI_DAILY_CAP) || 3000);
  });
});

describe('writes cannot reach another account’s data', () => {
  it('renaming another account’s channel fails instead of succeeding silently', async () => {
    await expect(dataStore.renameChannel(userA, channelB, 'Hijacked')).rejects.toThrow();
    const [stillB] = await dataStore.getChannels(userB);
    expect(stillB.name).toBe('Account B Channel');
  });

  it('deleting another account’s channel fails instead of succeeding silently', async () => {
    await expect(dataStore.deleteChannel(userA, channelB)).rejects.toThrow();
    expect((await dataStore.getChannels(userB)).length).toBe(1);
  });

  it('marking another account’s article read only affects the acting account', async () => {
    const bArticles = await articlesCache.getArticles(userB, channelB);
    // Nothing stops A from naming B's article id — but the row it creates is A's own, and B's
    // view of that article must be unchanged.
    await dataStore.markRead(userA, bArticles[0].id);
    expect(await dataStore.isRead(userB, bArticles[0].id)).toBe(false);
  });
});
