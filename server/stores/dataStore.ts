/** Database-backed replacement for main/dataStore.ts's channels/subchannels/settings/bookmarks/
 * read-state/streak logic — same rules, same method surface (now async, and every method takes a
 * userId as the first argument instead of implicitly meaning "the one local install"). No
 * in-memory mirror or debounced write here: unlike the old whole-file-rewrite-on-every-mutation
 * design, each of these is already a small, targeted database operation, so there's nothing to
 * batch. The database itself is the only state. */

import { prisma } from '../db';
import { capitalizeWords, slugifyChannelName } from '../../channelName';
import type { AiProvider, AppSettings, BookmarkEntry, Channel, StreakInfo, Subchannel } from '../../ipc-contract';
import { OLLAMA_DEFAULT_MODEL } from '../../main/providers/classifier';
import { Prisma } from '../generated/prisma/client';
import type { Channel as PrismaChannel, Subchannel as PrismaSubchannel, Settings as PrismaSettings } from '../generated/prisma/client';

// Must match READ_ARCHIVE_DAYS in src/components/Channel/NewsFeed.tsx — see main/dataStore.ts's
// identical constant for why.
const READ_STATE_MAX_AGE_DAYS = 10;

const PAUSE_FOREVER_UNTIL = new Date('9999-12-31T00:00:00.000Z');
function pauseLabelForHours(hours: number): string {
  if (hours === 24) return '24 hours';
  if (hours === 48) return '48 hours';
  if (hours === 168) return '1 week';
  return `${hours} hours`;
}

/** Local (not UTC) calendar-date string — same streak-math contract as main/dataStore.ts. The
 * server has no single "user's timezone" of its own, so this takes the client-reported date
 * directly (see server/routes/streak.ts) rather than computing it from the server's own clock. */
function daysBetweenLocalDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const aLocal = new Date(ay, am - 1, ad).getTime();
  const bLocal = new Date(by, bm - 1, bd).getTime();
  return Math.round((bLocal - aLocal) / (24 * 60 * 60 * 1000));
}

type ChannelWithSubchannels = PrismaChannel & { subchannels: PrismaSubchannel[] };

function toSubchannel(s: PrismaSubchannel): Subchannel {
  return { id: s.id, name: s.name, createdAt: s.createdAt.toISOString() };
}

function toChannel(c: ChannelWithSubchannels): Channel {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    createdAt: c.createdAt.toISOString(),
    sortOrder: c.sortOrder,
    subchannels: c.subchannels.map(toSubchannel),
    pausedUntil: c.pausedUntil ? c.pausedUntil.toISOString() : null,
    pausedLabel: c.pausedLabel,
  };
}

function toSettings(s: PrismaSettings): AppSettings {
  return {
    defaultViewMode: s.defaultViewMode as AppSettings['defaultViewMode'],
    refreshIntervalMinutes: s.refreshIntervalMinutes,
    theme: s.theme as AppSettings['theme'],
    rollTheDiceChannelIds: s.rollTheDiceChannelIds.length > 0 ? s.rollTheDiceChannelIds : null,
    maxStoriesShown: s.maxStoriesShown as AppSettings['maxStoriesShown'],
    homeLocation: s.homeLocation as AppSettings['homeLocation'],
  };
}

// --- Onboarding ---------------------------------------------------------------------------------

export async function getOnboardingStatus(userId: string): Promise<{ completed: boolean }> {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { userId } });
  return { completed: settings.onboardingCompleted };
}

export async function completeOnboarding(userId: string, initialChannelNames: string[]): Promise<Channel[]> {
  for (const name of initialChannelNames) {
    if (name.trim()) await createChannel(userId, name.trim());
  }
  await prisma.settings.update({
    where: { userId },
    data: { onboardingCompleted: true, onboardingCompletedAt: new Date() },
  });
  return getChannels(userId);
}

// --- Channels ------------------------------------------------------------------------------------

export async function getChannels(userId: string): Promise<Channel[]> {
  const channels = await prisma.channel.findMany({
    where: { userId },
    include: { subchannels: { orderBy: { createdAt: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });
  return channels.map(toChannel);
}

// A second, independent axis from the search-budget cap in providerBudget.ts: that one bounds
// day-to-day refresh cost, this one bounds how much standing load a single guest account can add to
// begin with. The founder's own account has 9 real channels — 25 is generous headroom for a real
// guest while still capping any one signup's worst case. Never enforced for the owner.
export const MAX_CHANNELS_PER_USER = 25;

export async function createChannel(userId: string, name: string): Promise<Channel> {
  const capitalized = capitalizeWords(name.trim());
  const slug = slugifyChannelName(capitalized);
  const existing = await prisma.channel.findUnique({
    where: { userId_slug: { userId, slug } },
    include: { subchannels: true },
  });
  if (existing) return toChannel(existing);

  const count = await prisma.channel.count({ where: { userId } });
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { isOwner: true } });
  if (!owner?.isOwner && count >= MAX_CHANNELS_PER_USER) {
    throw new Error(`You've reached the maximum of ${MAX_CHANNELS_PER_USER} channels per account.`);
  }
  const created = await prisma.channel.create({
    data: { userId, name: capitalized, slug, sortOrder: count },
    include: { subchannels: true },
  });
  return toChannel(created);
}

export async function setChannelPause(
  userId: string,
  channelId: string,
  duration: number | 'forever' | null
): Promise<void> {
  const data =
    duration == null
      ? { pausedUntil: null, pausedLabel: null }
      : duration === 'forever'
        ? { pausedUntil: PAUSE_FOREVER_UNTIL, pausedLabel: 'until I say so' }
        : { pausedUntil: new Date(Date.now() + duration * 3600_000), pausedLabel: pauseLabelForHours(duration) };
  await prisma.channel.update({ where: { id: channelId, userId }, data });
}

export async function isChannelPaused(userId: string, channelId: string): Promise<boolean> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId, userId } });
  return !!channel?.pausedUntil && channel.pausedUntil.getTime() > Date.now();
}

export async function setChannelOrder(userId: string, orderedIds: string[]): Promise<void> {
  const existing = await prisma.channel.findMany({ where: { userId }, select: { id: true } });
  const existingIds = new Set(existing.map((c) => c.id));
  const reordered = orderedIds.filter((id) => existingIds.has(id));
  for (const id of existingIds) if (!reordered.includes(id)) reordered.push(id);

  await prisma.$transaction(
    reordered.map((id, i) => prisma.channel.update({ where: { id, userId }, data: { sortOrder: i } }))
  );
}

export async function renameChannel(userId: string, channelId: string, name: string): Promise<void> {
  const capitalized = capitalizeWords(name.trim());
  await prisma.channel.update({
    where: { id: channelId, userId },
    data: { name: capitalized, slug: slugifyChannelName(capitalized) },
  });
}

export async function deleteChannel(userId: string, channelId: string): Promise<void> {
  // Subchannels/articles/bookmarks/classification verdicts cascade automatically (onDelete:
  // Cascade in the schema) — only the scalar rollTheDiceChannelIds array needs a manual scrub,
  // since Postgres has no foreign key to cascade through a plain array column.
  await prisma.channel.delete({ where: { id: channelId, userId } });
  const settings = await prisma.settings.findUnique({ where: { userId } });
  if (settings?.rollTheDiceChannelIds.includes(channelId)) {
    await prisma.settings.update({
      where: { userId },
      data: { rollTheDiceChannelIds: settings.rollTheDiceChannelIds.filter((id) => id !== channelId) },
    });
  }
}

export async function reorderChannel(userId: string, channelId: string, direction: 'up' | 'down'): Promise<void> {
  const list = await prisma.channel.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } });
  const idx = list.findIndex((c) => c.id === channelId);
  if (idx === -1) return;
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) return;
  [list[idx], list[swapWith]] = [list[swapWith], list[idx]];
  await prisma.$transaction(
    list.map((c, i) => prisma.channel.update({ where: { id: c.id, userId }, data: { sortOrder: i } }))
  );
}

// --- Subchannels -----------------------------------------------------------------------------------

export async function addSubchannel(userId: string, channelId: string, name: string): Promise<Subchannel> {
  const created = await prisma.subchannel.create({
    data: { userId, channelId, name: capitalizeWords(name.trim()) },
  });
  return toSubchannel(created);
}

export async function renameSubchannel(
  userId: string,
  channelId: string,
  subchannelId: string,
  name: string
): Promise<void> {
  await prisma.subchannel.update({
    where: { id: subchannelId, userId, channelId },
    data: { name: capitalizeWords(name.trim()) },
  });
}

export async function deleteSubchannel(userId: string, channelId: string, subchannelId: string): Promise<void> {
  await prisma.subchannel.delete({ where: { id: subchannelId, userId, channelId } });
}

// --- Bookmarks ---------------------------------------------------------------------------------

export async function toggleBookmark(
  userId: string,
  articleId: string,
  channelId: string,
  snapshotIfAdding?: BookmarkEntry['articleSnapshot'] & { subchannelId: string | null }
): Promise<{ bookmarked: boolean }> {
  const existing = await prisma.bookmark.findUnique({ where: { userId_articleId: { userId, articleId } } });
  if (existing) {
    await prisma.bookmark.delete({ where: { id: existing.id } });
    return { bookmarked: false };
  }
  if (!snapshotIfAdding) throw new Error('articleSnapshot required to add a bookmark');
  await prisma.bookmark.create({
    data: {
      userId,
      channelId,
      subchannelId: snapshotIfAdding.subchannelId,
      articleId,
      articleSnapshot: {
        url: snapshotIfAdding.url,
        title: snapshotIfAdding.title,
        snippet: snapshotIfAdding.snippet,
        source: snapshotIfAdding.source,
        publishedAt: snapshotIfAdding.publishedAt,
        paywalled: snapshotIfAdding.paywalled,
        imageUrl: snapshotIfAdding.imageUrl,
      },
    },
  });
  return { bookmarked: true };
}

export async function getBookmarksByChannel(userId: string): Promise<Record<string, BookmarkEntry[]>> {
  const bookmarks = await prisma.bookmark.findMany({ where: { userId }, orderBy: { bookmarkedAt: 'desc' } });
  // One batched read-state lookup instead of the previous `await isRead(...)` inside the loop, which
  // was a separate database round trip per bookmark — and, being awaited in sequence, made the whole
  // response as slow as the sum of them.
  const readIds = new Set(
    (
      await prisma.readState.findMany({
        where: { userId, articleId: { in: bookmarks.map((b) => b.articleId) } },
        select: { articleId: true },
      })
    ).map((r) => r.articleId)
  );
  const byChannel: Record<string, BookmarkEntry[]> = {};
  for (const b of bookmarks) {
    (byChannel[b.channelId] ??= []).push({
      id: b.id,
      channelId: b.channelId,
      subchannelId: b.subchannelId,
      articleId: b.articleId,
      bookmarkedAt: b.bookmarkedAt.toISOString(),
      articleSnapshot: b.articleSnapshot as unknown as BookmarkEntry['articleSnapshot'],
      read: readIds.has(b.articleId),
    });
  }
  return byChannel;
}

// --- Read state ----------------------------------------------------------------------------------

export async function isRead(userId: string, articleId: string): Promise<boolean> {
  const row = await prisma.readState.findUnique({ where: { userId_articleId: { userId, articleId } } });
  return !!row;
}

/** Every read article id for this user — used to build the full exclude-set for "Roll the dice"
 * (see routes.ts's /random-article), matching the original's getReadArticleIds(). */
export async function getReadArticleIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.readState.findMany({ where: { userId }, select: { articleId: true } });
  return new Set(rows.map((r) => r.articleId));
}

export async function markRead(userId: string, articleId: string): Promise<void> {
  await prisma.readState.upsert({
    where: { userId_articleId: { userId, articleId } },
    create: { userId, articleId },
    update: {},
  });
  await pruneReadState(userId);
}

export async function markManyRead(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.readState.createMany({
    data: ids.map((articleId) => ({ userId, articleId })),
    skipDuplicates: true,
  });
  await pruneReadState(userId);
}

export async function markUnread(userId: string, articleId: string): Promise<void> {
  await prisma.readState.deleteMany({ where: { userId, articleId } });
}

/** Same "the underlying article is long gone from the cache by now, so its read-state row can
 * never be meaningfully queried again" reasoning as main/dataStore.ts's pruneReadArticleIds. */
async function pruneReadState(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - READ_STATE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  await prisma.readState.deleteMany({ where: { userId, readAt: { lt: cutoff } } });
}

// --- Streak --------------------------------------------------------------------------------------

/** Same "advance only on a genuine catch-up, once per calendar day" rule as main/dataStore.ts —
 * `today` is passed in (the caller's own local calendar date) rather than computed from the
 * server's clock, since the server has no single "the user's timezone" the way a desktop process
 * pinned to one machine did. */
export async function recordCatchUp(userId: string, today: string): Promise<StreakInfo> {
  const streak = await prisma.streak.findUniqueOrThrow({ where: { userId } });
  const lastDate = streak.lastCaughtUpDate ? streak.lastCaughtUpDate.toISOString().slice(0, 10) : null;

  if (lastDate === today) return { current: streak.current, lastOpenedDate: lastDate };

  const nextCurrent = lastDate && daysBetweenLocalDates(lastDate, today) === 1 ? streak.current + 1 : 1;
  const updated = await prisma.streak.update({
    where: { userId },
    data: { current: nextCurrent, lastCaughtUpDate: new Date(today) },
  });
  return { current: updated.current, lastOpenedDate: today };
}

export async function getStreak(userId: string): Promise<StreakInfo> {
  const streak = await prisma.streak.findUniqueOrThrow({ where: { userId } });
  return {
    current: streak.current,
    lastOpenedDate: streak.lastCaughtUpDate ? streak.lastCaughtUpDate.toISOString().slice(0, 10) : null,
  };
}

// --- Settings --------------------------------------------------------------------------------------

export async function getSettings(userId: string): Promise<AppSettings> {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { userId } });
  return toSettings(settings);
}

export async function setSettings(userId: string, partial: Partial<AppSettings>): Promise<void> {
  await prisma.settings.update({
    where: { userId },
    data: {
      ...(partial.defaultViewMode !== undefined && { defaultViewMode: partial.defaultViewMode }),
      ...(partial.refreshIntervalMinutes !== undefined && { refreshIntervalMinutes: partial.refreshIntervalMinutes }),
      ...(partial.theme !== undefined && { theme: partial.theme }),
      ...(partial.rollTheDiceChannelIds !== undefined && {
        rollTheDiceChannelIds: partial.rollTheDiceChannelIds ?? [],
      }),
      ...(partial.maxStoriesShown !== undefined && { maxStoriesShown: partial.maxStoriesShown }),
      ...(partial.homeLocation !== undefined && {
        homeLocation: partial.homeLocation === null ? Prisma.DbNull : (partial.homeLocation as object),
      }),
    },
  });
}

// --- AI relevance filtering ---------------------------------------------------------------------

export interface AiSettings {
  provider: AiProvider | null;
  geminiApiKey: string | null;
  groqApiKey: string | null;
  ollamaModel: string;
}

/** Everything the AI layer needs, in ONE selected read. The individual getters below each issue
 * their own `findUniqueOrThrow` for the same row, so the two callers that want several at once
 * (`GET /ai-config` and refreshAgent's per-channel setup) were reading the same Settings row four
 * times per call — four full-row fetches where one narrow one does. The single-value getters are
 * kept for the routes that genuinely only need one thing. */
export async function getAiSettings(userId: string): Promise<AiSettings> {
  const s = await prisma.settings.findUniqueOrThrow({
    where: { userId },
    select: { aiProvider: true, aiEnabled: true, aiApiKey: true, groqApiKey: true, ollamaModel: true },
  });
  return {
    provider: aiProviderFrom(s),
    geminiApiKey: s.aiApiKey,
    groqApiKey: s.groqApiKey,
    ollamaModel: s.ollamaModel,
  };
}

/** null on rows saved before providers existed — falls back to the legacy aiEnabled+aiApiKey pair
 * (Gemini was the only provider then, so "on" with a key stored unambiguously meant Gemini). */
function aiProviderFrom(s: { aiProvider: string | null; aiEnabled: boolean; aiApiKey: string | null }): AiProvider | null {
  if (s.aiProvider) return s.aiProvider as AiProvider;
  return s.aiEnabled && s.aiApiKey ? 'gemini' : null;
}

export async function getAiProvider(userId: string): Promise<AiProvider | null> {
  const settings = await prisma.settings.findUniqueOrThrow({
    where: { userId },
    select: { aiProvider: true, aiEnabled: true, aiApiKey: true },
  });
  return aiProviderFrom(settings);
}

export async function setAiProvider(userId: string, provider: AiProvider | null): Promise<void> {
  await prisma.settings.update({ where: { userId }, data: { aiProvider: provider } });
}

export async function setGeminiApiKey(userId: string, key: string | null): Promise<void> {
  await prisma.settings.update({
    where: { userId },
    data: { aiApiKey: key && key.trim() ? key.trim() : null },
  });
}

export async function setGroqApiKey(userId: string, key: string | null): Promise<void> {
  await prisma.settings.update({
    where: { userId },
    data: { groqApiKey: key && key.trim() ? key.trim() : null },
  });
}

export async function setOllamaModel(userId: string, model: string): Promise<void> {
  await prisma.settings.update({
    where: { userId },
    data: { ollamaModel: model.trim() || OLLAMA_DEFAULT_MODEL },
  });
}
