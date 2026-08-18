import fs from 'fs';
import crypto from 'crypto';
import { dataFilePath } from './paths';
import { capitalizeWords, slugifyChannelName } from '../channelName';
import type {
  AiProvider,
  AppSettings,
  BookmarkEntry,
  Channel,
  StreakInfo,
  Subchannel,
} from '../ipc-contract';
import { OLLAMA_DEFAULT_MODEL } from './providers/classifier';

interface ReadEntry {
  id: string;
  readAt: string;
}

/** BookmarkEntry minus `read` — that field is computed at read time by joining against read-state
 * (like Article.read/bookmarked already are), not persisted alongside the bookmark itself. */
type StoredBookmarkEntry = Omit<BookmarkEntry, 'read'>;

/** AI relevance filtering. Kept OUT of `settings` because `settings` is sent to the renderer wholesale
 * (getSettings) and the api keys are secrets — the renderer only ever learns whether one is configured
 * (see ipcHandlers.getAiConfig), never the keys themselves. */
interface AiState {
  provider: AiProvider | null;
  geminiApiKey: string | null;
  groqApiKey: string | null;
  ollamaModel: string;
}

const DEFAULT_AI_STATE: AiState = {
  provider: null,
  geminiApiKey: null,
  groqApiKey: null,
  ollamaModel: OLLAMA_DEFAULT_MODEL,
};

/** Reads a persisted `ai` field written by either the current shape or the pre-provider-choice shape
 * ({enabled, apiKey}) — a stored Gemini key with filtering on implies the provider was Gemini, the
 * only one that ever existed then. Also fills in any field a file saved before it existed lacks. */
function migrateAiState(raw: unknown): AiState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_AI_STATE };
  const r = raw as Record<string, unknown>;
  if ('provider' in r) return { ...DEFAULT_AI_STATE, ...(r as Partial<AiState>) };
  const enabled = r.enabled === true;
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey : null;
  return {
    ...DEFAULT_AI_STATE,
    provider: enabled && apiKey ? 'gemini' : null,
    geminiApiKey: apiKey,
  };
}

interface DataFile {
  schemaVersion: 1;
  userId: 'local';
  onboarding: { completed: boolean; completedAt: string | null };
  settings: AppSettings;
  ai: AiState;
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
    trustedSourceDomains: [],
    maxStoriesShown: 25,
    homeLocation: null,
  },
  ai: { ...DEFAULT_AI_STATE },
  channels: [],
  bookmarks: [],
  readArticleIds: [],
  streak: { current: 0, lastOpenedDate: null },
};

// Must match READ_ARCHIVE_DAYS in src/components/Channel/NewsFeed.tsx — that's what the "Read
// stories · 10 day archive" label promises, this is what actually stops collecting past it.
const READ_STATE_MAX_AGE_DAYS = 10;

// Sentinel pausedUntil for an indefinite ("until I say so") pause — far enough out that the normal
// "pausedUntil > now" check treats it as paused forever, no special-casing needed.
const PAUSE_FOREVER_UNTIL = '9999-12-31T00:00:00.000Z';
function pauseLabelForHours(hours: number): string {
  if (hours === 24) return '24 hours';
  if (hours === 48) return '48 hours';
  if (hours === 168) return '1 week';
  return `${hours} hours`;
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
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
const WRITE_DEBOUNCE_MS = 250;

export class DataStore {
  private data: DataFile;
  private readonly filePath: string;
  /** In-memory mirror of `data.readArticleIds` for O(1) lookups — `isRead` is called once per
   * article on every `getArticles` response and can realistically reach thousands of entries,
   * unlike bookmarks, which stay small because they're deliberate, infrequent user actions. */
  private readIds: Set<string>;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = dataFilePath();
    this.data = this.read();
    this.readIds = new Set(this.data.readArticleIds.map((r) => r.id));
    this.migrateCapitalization();
    // Backfill pause fields for channels saved before the pause feature existed.
    for (const channel of this.data.channels) {
      if (channel.pausedUntil === undefined) channel.pausedUntil = null;
      if (channel.pausedLabel === undefined) channel.pausedLabel = null;
    }
  }

  /** One-time normalization for channels/subchannels created before auto-capitalization existed —
   * createChannel/renameChannel/addSubchannel/renameSubchannel only capitalize names going
   * forward, so anything already on disk needs a pass too. */
  private migrateCapitalization(): void {
    let changed = false;
    for (const channel of this.data.channels) {
      const capitalized = capitalizeWords(channel.name.trim());
      if (capitalized !== channel.name) {
        channel.name = capitalized;
        channel.slug = slugifyChannelName(capitalized);
        changed = true;
      }
      for (const sub of channel.subchannels) {
        const subCapitalized = capitalizeWords(sub.name.trim());
        if (subCapitalized !== sub.name) {
          sub.name = subCapitalized;
          changed = true;
        }
      }
    }
    if (changed) this.persistNow();
  }

  private read(): DataFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as DataFile;
      // `settings` and `ai` are merged one level deeper than the rest of the file — a plain top-level
      // spread would let an existing object (saved before a new field existed, e.g. maxStoriesShown,
      // or before the ai field's shape changed at all) wholesale shadow DEFAULT_DATA and leave newer
      // fields undefined.
      return {
        ...DEFAULT_DATA,
        ...parsed,
        settings: { ...DEFAULT_DATA.settings, ...parsed.settings },
        ai: migrateAiState(parsed.ai),
      };
    } catch {
      return structuredClone(DEFAULT_DATA);
    }
  }

  private persistNow(): void {
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  /** Debounced instead of writing synchronously on every single mutation — a plain
   * fs.writeFileSync on every call (including markRead, which fires on nearly every card
   * interaction) blocks the main process's event loop, and therefore IPC/UI responsiveness
   * across every window, for the duration of each write. Coalescing rapid-fire mutations into
   * one write after a short quiet window keeps the same on-disk behavior (still a full-file,
   * atomic temp-then-rename write) without doing it on every click. flush() (wired to app quit)
   * guarantees nothing pending is lost on a clean exit. */
  private write(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persistNow();
    }, WRITE_DEBOUNCE_MS);
  }

  /** Immediately writes any pending debounced mutation — call before the process exits so a
   * mutation that landed right before quit isn't silently lost. */
  flush(): void {
    if (!this.writeTimer) return;
    clearTimeout(this.writeTimer);
    this.writeTimer = null;
    this.persistNow();
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
      (c) => c.slug === slugifyChannelName(capitalized)
    );
    if (existing) return existing;
    const channel: Channel = {
      id: genId('chn'),
      name: capitalized,
      slug: slugifyChannelName(capitalized),
      createdAt: new Date().toISOString(),
      sortOrder: this.data.channels.length,
      subchannels: [],
      pausedUntil: null,
      pausedLabel: null,
    };
    this.data.channels.push(channel);
    if (opts.persist !== false) this.write();
    return channel;
  }

  /** Pause a channel's auto-refresh: a number of hours, 'forever' (indefinite), or null to resume. */
  setChannelPause(channelId: string, duration: number | 'forever' | null): void {
    const channel = this.requireChannel(channelId);
    if (duration == null) {
      channel.pausedUntil = null;
      channel.pausedLabel = null;
    } else if (duration === 'forever') {
      channel.pausedUntil = PAUSE_FOREVER_UNTIL;
      channel.pausedLabel = 'until I say so';
    } else {
      channel.pausedUntil = new Date(Date.now() + duration * 3600_000).toISOString();
      channel.pausedLabel = pauseLabelForHours(duration);
    }
    this.write();
  }

  /** Whether the channel is currently paused (pausedUntil in the future). Expired pauses read as
   * active without needing a separate cleanup pass. */
  isChannelPaused(channelId: string): boolean {
    const channel = this.data.channels.find((c) => c.id === channelId);
    return !!channel?.pausedUntil && new Date(channel.pausedUntil).getTime() > Date.now();
  }

  /** Reorder all channels to match the given id order (Home drag-to-reorder), renumbering sortOrder.
   * Ids not present are appended in their existing relative order, so a stale list can't drop any. */
  setChannelOrder(orderedIds: string[]): void {
    const byId = new Map(this.data.channels.map((c) => [c.id, c]));
    const reordered: Channel[] = [];
    for (const id of orderedIds) {
      const c = byId.get(id);
      if (c && !reordered.includes(c)) reordered.push(c);
    }
    for (const c of this.data.channels) if (!reordered.includes(c)) reordered.push(c);
    reordered.forEach((c, i) => (c.sortOrder = i));
    this.data.channels = reordered;
    this.write();
  }

  renameChannel(channelId: string, name: string): void {
    const channel = this.requireChannel(channelId);
    const capitalized = capitalizeWords(name.trim());
    channel.name = capitalized;
    channel.slug = slugifyChannelName(capitalized);
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
      name: capitalizeWords(name.trim()),
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
    sub.name = capitalizeWords(name.trim());
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

  /** Mark many articles read in one write (manual "clear" of a channel). */
  markManyRead(ids: string[]): void {
    let changed = false;
    const at = new Date().toISOString();
    for (const id of ids) {
      if (this.readIds.has(id)) continue;
      this.readIds.add(id);
      this.data.readArticleIds.push({ id, readAt: at });
      changed = true;
    }
    if (changed) {
      this.pruneReadArticleIds();
      this.write();
    }
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

  // AI relevance filtering. Keys never leave the main process except as booleans via
  // hasGeminiApiKey()/hasGroqApiKey() (see ipcHandlers.getAiConfig).
  getAiProvider(): AiProvider | null {
    return this.data.ai.provider;
  }

  setAiProvider(provider: AiProvider | null): void {
    this.data.ai.provider = provider;
    this.write();
  }

  getGeminiApiKey(): string | null {
    return this.data.ai.geminiApiKey;
  }

  hasGeminiApiKey(): boolean {
    return !!this.data.ai.geminiApiKey;
  }

  setGeminiApiKey(key: string | null): void {
    this.data.ai.geminiApiKey = key && key.trim() ? key.trim() : null;
    this.write();
  }

  getGroqApiKey(): string | null {
    return this.data.ai.groqApiKey;
  }

  hasGroqApiKey(): boolean {
    return !!this.data.ai.groqApiKey;
  }

  setGroqApiKey(key: string | null): void {
    this.data.ai.groqApiKey = key && key.trim() ? key.trim() : null;
    this.write();
  }

  getOllamaModel(): string {
    return this.data.ai.ollamaModel;
  }

  setOllamaModel(model: string): void {
    this.data.ai.ollamaModel = model.trim() || OLLAMA_DEFAULT_MODEL;
    this.write();
  }

  private requireChannel(channelId: string): Channel {
    const channel = this.data.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    return channel;
  }
}
