/** Locks in how a story that legitimately lives in TWO channels behaves.
 *
 * The same real-world story can be picked up by two different channels' searches, so it gets its
 * own row in each (see the Article model's composite primary key). That raised a question the old
 * desktop app never actually decided — it just inherited whatever fell out of the implementation:
 * if you bookmark or read that story in one channel, what happens in the other?
 *
 * Confirmed and chosen deliberately (2026-08-01): BOTH are treated as one story, not two.
 *   - Reading it in one channel marks it read everywhere.
 *   - Un-bookmarking it in one channel removes the bookmark everywhere.
 * That matches how a person thinks about it ("I already read that"), and it's what the schema does
 * today via read state and bookmarks being keyed per (account, article) rather than per channel.
 *
 * These tests exist because that is now a decision rather than an accident — a future change to
 * per-channel read state would be a real product change and should have to break a test to happen.
 *
 * Run with `npm run test:db` (needs DATABASE_URL). Kept out of the default `npm test`. */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../db';
import * as dataStore from './dataStore';
import * as articlesCache from './articlesCache';

const EMAIL = `cross-channel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const SHARED_URL = 'https://example.test/a-story-two-channels-both-found';

let userId = '';
let channelOne = '';
let channelTwo = '';
let sharedArticleId = '';

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: EMAIL } });
  userId = user.id;
  await prisma.settings.create({ data: { userId } });
  await prisma.streak.create({ data: { userId } });

  channelOne = (await dataStore.createChannel(userId, 'Channel One')).id;
  channelTwo = (await dataStore.createChannel(userId, 'Channel Two')).id;

  // The same story, found independently by both channels' searches — exactly the real-world case
  // that produced 19 such articles in the founder's own migrated data.
  const story = {
    url: SHARED_URL,
    title: 'One story that both channels matched',
    snippet: null,
    source: 'Example',
    publishedAt: new Date().toISOString(),
    imageUrl: null,
    provider: 'guardian',
  };
  await articlesCache.merge(userId, channelOne, null, [story]);
  await articlesCache.merge(userId, channelTwo, null, [story]);

  sharedArticleId = (await articlesCache.getArticles(userId, channelOne))[0].id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe('a story matched by two channels', () => {
  it('really does exist in both channels (not silently dropped from one)', async () => {
    const inOne = await articlesCache.getArticles(userId, channelOne);
    const inTwo = await articlesCache.getArticles(userId, channelTwo);
    expect(inOne.map((a) => a.id)).toEqual([sharedArticleId]);
    expect(inTwo.map((a) => a.id)).toEqual([sharedArticleId]);
  });

  it('reading it in one channel marks it read in the other', async () => {
    await dataStore.markRead(userId, sharedArticleId);
    const inTwo = await articlesCache.getArticles(userId, channelTwo);
    expect(inTwo[0].read).toBe(true);
  });

  it('marking it unread in one channel marks it unread in the other', async () => {
    await dataStore.markUnread(userId, sharedArticleId);
    const inOne = await articlesCache.getArticles(userId, channelOne);
    const inTwo = await articlesCache.getArticles(userId, channelTwo);
    expect(inOne[0].read).toBe(false);
    expect(inTwo[0].read).toBe(false);
  });

  it('un-bookmarking it in one channel removes the bookmark from the other too', async () => {
    const snapshot = {
      subchannelId: null,
      url: SHARED_URL,
      title: 'One story that both channels matched',
      snippet: null,
      source: 'Example',
      publishedAt: new Date().toISOString(),
      paywalled: false,
      imageUrl: null,
    };
    // Bookmark it from channel one...
    expect(await dataStore.toggleBookmark(userId, sharedArticleId, channelOne, snapshot)).toEqual({ bookmarked: true });
    expect(Object.keys(await dataStore.getBookmarksByChannel(userId))).toEqual([channelOne]);

    // ...then toggle it from channel two: it's one story, so this REMOVES it rather than adding a
    // second, independent bookmark.
    expect(await dataStore.toggleBookmark(userId, sharedArticleId, channelTwo, snapshot)).toEqual({ bookmarked: false });
    expect(Object.keys(await dataStore.getBookmarksByChannel(userId))).toEqual([]);
  });
});
