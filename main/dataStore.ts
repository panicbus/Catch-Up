import fs from 'fs';
import crypto from 'crypto';
import { dataFilePath } from './paths';
import type {
  AppSettings,
  BookmarkEntry,
  Channel,
  StreakInfo,
  Subchannel,
} from '../ipc-contract';

interface ReadEntry {
  id: string;
  readAt: string;
}

/** BookmarkEntry minus `read` — that field is computed at read time by joining against read-state
 * (like Article.read/bookmarked already are), not persisted alongside the bookmark itself. */
type StoredBookmarkEntry = Omit<BookmarkEntry, 'read'>;

interface DataFile {
  schemaVersion: 1;
  userId: 'local';
  onboarding: { completed: boolean; completedAt: string | null };
  settings: AppSettings;
  channels: Channel[];
  bookmarks: StoredBookmarkEntry[];
  readArticleIds: ReadEntry[];
  streak: StreakInfo;
}

const DEFAULT_DATA: DataFile = {
  schemaVersion: 1,
  userId: 'local',
  onboarding: { completed: false, completedAt: null },
  settings: {
    defaultViewMode: 'list',
    refreshIntervalMinutes: 30,
    theme: 'light',
    rollTheDiceChannelIds: null,
    maxStoriesShown: 25,
  },
  channels: [],
  bookmarks: [],
  readArticleIds: [],
  streak: { current: 0, lastOpenedDate: null },
};

// Must match READ_ARCHIVE_DAYS in src/components/Channel/NewsFeed.tsx — that's what the "Read
// stories · 2 week archive" label promises, this is what actually stops collecting past it.
const READ_STATE_MAX_AGE_DAYS = 14;

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/** Capitalizes the first letter of each word, leaving the rest of each word untouched so acronyms
 * the user already typed correctly (e.g. "NASA", "F1") survive rather than getting lowercased. */
function capitalizeWords(name: string): string {
  return name
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Local (not UTC) calendar-date string, e.g. "2026-07-19" — daily streak math must use
 * calendar days in the user's own timezone, not elapsed milliseconds or UTC dates. */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole-day difference between two "YYYY-MM-DD" local-date strings. */
function daysBetweenLocalDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const aLocal = new Date(ay, am - 1, ad).getTime();
  const bLocal = new Date(by, bm - 1, bd).getTime();
  return Math.round((bLocal - aLocal) / (24 * 60 * 60 * 1000));
}

/** JSON-file-backed store for durable, instantly-mutable user content: channels, bookmarks, settings.
 * Writes via temp-file-then-rename for atomicity. Owned by the main process so the background
 * refresh agent can read/write it regardless of whether any renderer window is open. */
export class DataStore {
  private data: DataFile;
  private readonly filePath: string;
  /** In-memory mirror of `data.readArticleIds` for O(1) lookups — `isRead` is called once per
   * article on every `getArticles` response and can realistically reach thousands of entries,
   * unlike bookmarks, which stay small because they're deliberate, infrequent user actions. */
  private readIds: Set<string>;

  constructor() {
    this.filePath = dataFilePath();
    this.data = this.read();
    this.readIds = new Set(this.data.readArticleIds.map((r) => r.id));
    this.migrateChannelCapitalization();
  }

  /** One-time normalization for channels created before auto-capitalization existed — createChannel/
   * renameChannel only capitalize names going forward, so anything already on disk needs a pass too. */
  private migrateChannelCapitalization(): void {
    let changed = false;
    for (const channel of this.data.channels) {
      const capitalized = capitalizeWords(channel.name.trim());
      if (capitalized !== channel.name) {
        channel.name = capitalized;
        channel.slug = slugify(capitalized);
        changed = true;
      }
    }
    if (changed) this.write();
  }

  private read(): DataFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as DataFile;
      // `settings` is merged one level deeper than the rest of the file — a plain top-level spread
      // would let an existing settings object (saved before a new AppSettings field existed, e.g.
      // maxStoriesShown) wholesale shadow DEFAULT_DATA.settings and leave that field undefined.
      return { ...DEFAULT_DATA, ...parsed, settings: { ...DEFAULT_DATA.settings, ...parsed.settings } };
    } catch {
      return structuredClone(DEFAULT_DATA);
    }
  }

  private write(): void {
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  // Onboarding
  getOnboardingStatus(): { completed: boolean } {
    return { completed: this.data.onboarding.completed };
  }

  completeOnboarding(initialChannelNames: string[]): Channel[] {
    for (const name of initialChannelNames) {
      if (name.trim()) this.createChannel(name.trim(), { persist: false });
    }
    this.data.onboarding = { completed: true, completedAt: new Date().toISOString() };
    this.write();
    return this.data.channels;
  }

  // Channels
  getChannels(): Channel[] {
    return this.data.channels;
  }

  createChannel(name: string, opts: { persist?: boolean } = {}): Channel {
    const capitalized = capitalizeWords(name.trim());
    const existing = this.data.channels.find(
      (c) => c.slug === slugify(capitalized)
    );
    if (existing) return existing;
    const channel: Channel = {
      id: genId('chn'),
      name: capitalized,
      slug: slugify(capitalized),
      createdAt: new Date().toISOString(),
      sortOrder: this.data.channels.length,
      subchannels: [],
    };
    this.data.channels.push(channel);
    if (opts.persist !== false) this.write();
    return channel;
  }

  renameChannel(channelId: string, name: string): void {
    const channel = this.requireChannel(channelId);
    const capitalized = capitalizeWords(name.trim());
    channel.name = capitalized;
    channel.slug = slugify(capitalized);
    this.write();
  }

  deleteChannel(channelId: string): void {
    this.data.channels = this.data.channels.filter((c) => c.id !== channelId);
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.channelId !== channelId);
    if (this.data.settings.rollTheDiceChannelIds) {
      this.data.settings.rollTheDiceChannelIds = this.data.settings.rollTheDiceChannelIds.filter(
        (id) => id !== channelId
      );
    }
    this.write();
  }

  reorderChannel(channelId: string, direction: 'up' | 'down'): void {
    const list = this.data.channels;
    const idx = list.findIndex((c) => c.id === channelId);
    if (idx === -1) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= list.length) return;
    [list[idx], list[swapWith]] = [list[swapWith], list[idx]];
    list.forEach((c, i) => (c.sortOrder = i));
    this.write();
  }

  // Subchannels
  addSubchannel(channelId: string, name: string): Subchannel {
    const channel = this.requireChannel(channelId);
    const sub: Subchannel = {
      id: genId('sub'),
      name,
      createdAt: new Date().toISOString(),
    };
    channel.subchannels.push(sub);
    this.write();
    return sub;
  }

  renameSubchannel(channelId: string, subchannelId: string, name: string): void {
    const channel = this.requireChannel(channelId);
    const sub = channel.subchannels.find((s) => s.id === subchannelId);
    if (!sub) throw new Error(`Subchannel not found: ${subchannelId}`);
    sub.name = name;
    this.write();
  }

  deleteSubchannel(channelId: string, subchannelId: string): void {
    const channel = this.requireChannel(channelId);
    channel.subchannels = channel.subchannels.filter((s) => s.id !== subchannelId);
    this.write();
  }

  // Bookmarks
  toggleBookmark(
    articleId: string,
    channelId: string,
    snapshotIfAdding?: BookmarkEntry['articleSnapshot'] & { subchannelId: string | null }
  ): { bookmarked: boolean } {
    const idx = this.data.bookmarks.findIndex((b) => b.articleId === articleId);
    if (idx !== -1) {
      this.data.bookmarks.splice(idx, 1);
      this.write();
      return { bookmarked: false };
    }
    if (!snapshotIfAdding) throw new Error('articleSnapshot required to add a bookmark');
    const entry: StoredBookmarkEntry = {
      id: genId('bkm'),
      channelId,
      subchannelId: snapshotIfAdding.subchannelId,
      articleId,
      bookmarkedAt: new Date().toISOString(),
      articleSnapshot: {
        url: snapshotIfAdding.url,
        title: snapshotIfAdding.title,
        snippet: snapshotIfAdding.snippet,
        source: snapshotIfAdding.source,
        publishedAt: snapshotIfAdding.publishedAt,
        paywalled: snapshotIfAdding.paywalled,
        imageUrl: snapshotIfAdding.imageUrl,
      },
    };
    this.data.bookmarks.push(entry);
    this.write();
    return { bookmarked: true };
  }

  getBookmarksByChannel(): Record<string, BookmarkEntry[]> {
    const byChannel: Record<string, BookmarkEntry[]> = {};
    for (const bookmark of this.data.bookmarks) {
      (byChannel[bookmark.channelId] ??= []).push({ ...bookmark, read: this.isRead(bookmark.articleId) });
    }
    return byChannel;
  }

  isBookmarked(articleId: string): boolean {
    return this.data.bookmarks.some((b) => b.articleId === articleId);
  }

  // Read state
  isRead(articleId: string): boolean {
    return this.readIds.has(articleId);
  }

  markRead(articleId: string): void {
    if (this.readIds.has(articleId)) return;
    this.readIds.add(articleId);
    this.data.readArticleIds.push({ id: articleId, readAt: new Date().toISOString() });
    this.pruneReadArticleIds();
    this.write();
  }

  markUnread(articleId: string): void {
    if (!this.readIds.has(articleId)) return;
    this.readIds.delete(articleId);
    this.data.readArticleIds = this.data.readArticleIds.filter((r) => r.id !== articleId);
    this.write();
  }

  getReadArticleIds(): Set<string> {
    return this.readIds;
  }

  /** The underlying article is long gone from articlesCache's 14-day prune window by the time a
   * read-state entry is this old, so it can never be meaningfully queried again — drop it rather
   * than letting readArticleIds grow unboundedly in the small durable data file over months of use. */
  private pruneReadArticleIds(): void {
    const cutoff = Date.now() - READ_STATE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const before = this.data.readArticleIds.length;
    this.data.readArticleIds = this.data.readArticleIds.filter(
      (r) => new Date(r.readAt).getTime() >= cutoff
    );
    if (this.data.readArticleIds.length !== before) {
      this.readIds = new Set(this.data.readArticleIds.map((r) => r.id));
    }
  }

  // Streak
  /** Advances the streak when the user reaches "all caught up" on some channel — not merely for
   * opening the app, which would just reward presence rather than actually staying on top of
   * anything. Idempotent per calendar day: the first catch-up of the day advances it, later ones
   * that same day are no-ops, matching how this already behaved when the trigger was app-open. */
  recordCatchUp(): StreakInfo {
    const today = localDateString(new Date());
    const { lastOpenedDate, current } = this.data.streak;

    if (lastOpenedDate === today) return this.data.streak;

    const next: StreakInfo =
      lastOpenedDate && daysBetweenLocalDates(lastOpenedDate, today) === 1
        ? { current: current + 1, lastOpenedDate: today }
        : { current: 1, lastOpenedDate: today };

    this.data.streak = next;
    this.write();
    return next;
  }

  getStreak(): StreakInfo {
    return this.data.streak;
  }

  // Settings
  getSettings(): AppSettings {
    return this.data.settings;
  }

  setSettings(partial: Partial<AppSettings>): void {
    this.data.settings = { ...this.data.settings, ...partial };
    this.write();
  }

  private requireChannel(channelId: string): Channel {
    const channel = this.data.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    return channel;
  }
}
