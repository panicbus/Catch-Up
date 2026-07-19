import fs from 'fs';
import crypto from 'crypto';
import { dataFilePath } from './paths';
import type {
  AppSettings,
  BookmarkEntry,
  Channel,
  Subchannel,
} from '../ipc-contract';

interface DataFile {
  schemaVersion: 1;
  userId: 'local';
  onboarding: { completed: boolean; completedAt: string | null };
  settings: AppSettings;
  channels: Channel[];
  bookmarks: BookmarkEntry[];
}

const DEFAULT_DATA: DataFile = {
  schemaVersion: 1,
  userId: 'local',
  onboarding: { completed: false, completedAt: null },
  settings: {
    defaultViewMode: 'list',
    refreshIntervalMinutes: 30,
    theme: 'light',
  },
  channels: [],
  bookmarks: [],
};

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** JSON-file-backed store for durable, instantly-mutable user content: channels, bookmarks, settings.
 * Writes via temp-file-then-rename for atomicity. Owned by the main process so the background
 * refresh agent can read/write it regardless of whether any renderer window is open. */
export class DataStore {
  private data: DataFile;
  private readonly filePath: string;

  constructor() {
    this.filePath = dataFilePath();
    this.data = this.read();
  }

  private read(): DataFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as DataFile;
      return { ...DEFAULT_DATA, ...parsed };
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
    const existing = this.data.channels.find(
      (c) => c.slug === slugify(name)
    );
    if (existing) return existing;
    const channel: Channel = {
      id: genId('chn'),
      name,
      slug: slugify(name),
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
    channel.name = name;
    channel.slug = slugify(name);
    this.write();
  }

  deleteChannel(channelId: string): void {
    this.data.channels = this.data.channels.filter((c) => c.id !== channelId);
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.channelId !== channelId);
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
    const entry: BookmarkEntry = {
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
      (byChannel[bookmark.channelId] ??= []).push(bookmark);
    }
    return byChannel;
  }

  isBookmarked(articleId: string): boolean {
    return this.data.bookmarks.some((b) => b.articleId === articleId);
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
