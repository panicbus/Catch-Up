/** Shared IPC contract: preload bridge, renderer api wrapper, and documentation. */

export interface Subchannel {
  id: string;
  name: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  sortOrder: number;
  subchannels: Subchannel[];
  /** ISO timestamp the channel is paused until; null when active. A far-future sentinel means
   * "until I say so" (indefinite). While paused, the background refresh skips it and it shows grayed
   * out. */
  pausedUntil: string | null;
  /** Human label for the current pause ("24 hours", "1 week", "until I say so"), for the paused
   * channel view; null when active. */
  pausedLabel: string | null;
}

export interface Article {
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
  bookmarked: boolean;
  read: boolean;
}

export interface ArticleListParams {
  channelId: string;
  subchannelId?: string | null;
  limit?: number;
}

export interface ArticleListResult {
  articles: Article[];
}

export interface ArticleSnapshot {
  url: string;
  title: string;
  snippet: string | null;
  source: string;
  publishedAt: string;
  paywalled: boolean;
  imageUrl: string | null;
}

export interface BookmarkEntry {
  id: string;
  channelId: string;
  subchannelId: string | null;
  articleId: string;
  bookmarkedAt: string;
  articleSnapshot: ArticleSnapshot;
  /** Computed at read time by joining against read-state, like Article.read — not persisted here. */
  read: boolean;
}

export type ViewMode = 'list' | 'grid';
export type Theme = 'light' | 'dark';

export interface AppSettings {
  defaultViewMode: ViewMode;
  refreshIntervalMinutes: number;
  theme: Theme;
  /** Channel ids Roll the dice is allowed to pull from. null/undefined means every channel — the
   * default, and how pre-existing data files without this field behave once loaded. */
  rollTheDiceChannelIds: string[] | null;
  /** How many unread stories show at once in a channel's main feed before older ones are held
   * back (the read-stories archive is unaffected — this only caps the active unread list).
   * Defaults to 25, one of the three choices Settings offers (10/25/50), so the picker always
   * shows a real selection rather than landing on an unlabeled in-between value. */
  maxStoriesShown: 10 | 25 | 50;
  /** User's home city, used to deprioritize geographically distant local stories in topic/entity
   * channels (e.g. a "Wildfires" channel showing a small far-away town's fire story). Resolved
   * against the bundled city gazetteer at save time — `query` is what the user typed, `label`/
   * `lat`/`lon` are the resolved match. null = feature inactive (also how pre-existing data files
   * without this field behave once loaded). Never applied to broad category channels. */
  homeLocation: { query: string; label: string; lat: number; lon: number } | null;
}

export interface AiConfig {
  /** Whether AI relevance filtering is turned on. */
  enabled: boolean;
  /** Whether a Gemini API key is stored (the key itself is never sent to the renderer). */
  keyConfigured: boolean;
}

export interface SaveKeyResult {
  ok: boolean;
  /** User-facing reason the key was rejected, when ok is false. */
  error?: string;
}

export interface RefreshResult {
  channelId: string | null;
  added: number;
  providersRun: string[];
  errors: string[];
  /** Labels of currently-configured providers sitting out this refresh due to a rate limit/quota
   * failure — surfaced only here, on a user-triggered refresh, not as background console noise. */
  rateLimitedProviders: string[];
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  rateLimited: boolean;
}

export interface OnboardingStatus {
  completed: boolean;
}

export interface StreakInfo {
  current: number;
  /** Field name predates the current definition (kept as-is to avoid a data migration for an
   * internal-only field) — despite the name, this is now the last date the user reached "all
   * caught up" on some channel, not merely the last date they opened the app. See recordCatchUp. */
  lastOpenedDate: string | null;
}

export type DataChangeEvent =
  | { type: 'channels' }
  | { type: 'subchannels'; channelId: string }
  | { type: 'articles'; channelId: string }
  | { type: 'bookmarks'; channelId?: string }
  | { type: 'readState'; channelId?: string }
  | { type: 'settings' }
  | { type: 'streak' };

export interface CatchUpApi {
  // Onboarding
  getOnboardingStatus: () => Promise<OnboardingStatus>;
  completeOnboarding: (initialChannelNames: string[]) => Promise<Channel[]>;

  // Channel CRUD
  getChannels: () => Promise<Channel[]>;
  createChannel: (name: string) => Promise<Channel>;
  renameChannel: (channelId: string, name: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  reorderChannel: (channelId: string, direction: 'up' | 'down') => Promise<void>;
  /** Set the whole channel order at once (used by Home drag-to-reorder). Ids in display order. */
  setChannelOrder: (orderedIds: string[]) => Promise<void>;
  /** Pause a channel's auto-refresh: a number of hours (24/48/168), 'forever' (until explicitly
   * resumed), or null to resume immediately. */
  setChannelPause: (channelId: string, duration: number | 'forever' | null) => Promise<void>;
  /** Manually clear a channel: mark all its stories read (no caught-up celebration). */
  clearChannel: (channelId: string) => Promise<void>;

  // Subchannel CRUD
  addSubchannel: (channelId: string, name: string) => Promise<Subchannel>;
  renameSubchannel: (
    channelId: string,
    subchannelId: string,
    name: string
  ) => Promise<void>;
  deleteSubchannel: (channelId: string, subchannelId: string) => Promise<void>;

  // Articles
  getArticles: (params: ArticleListParams) => Promise<ArticleListResult>;
  refreshChannel: (channelId: string) => Promise<RefreshResult>;
  refreshAll: () => Promise<RefreshResult[]>;
  getProviderStatus: () => Promise<ProviderStatus[]>;

  // Bookmarks
  toggleBookmark: (articleId: string, channelId: string) => Promise<{ bookmarked: boolean }>;
  getBookmarksByChannel: () => Promise<Record<string, BookmarkEntry[]>>;

  // Read state
  markArticleRead: (articleId: string, channelId: string) => Promise<void>;
  markArticleUnread: (articleId: string, channelId: string) => Promise<void>;
  getRandomArticle: (excludeArticleId?: string) => Promise<Article | null>;

  // Streak
  getStreak: () => Promise<StreakInfo>;
  /** Call when the user reaches "all caught up" on a channel (unread hits zero via a genuine
   * >0 -> 0 transition, not a channel that just started empty) — this, not merely opening the
   * app, is what advances the streak. See NewsFeed's justCleared tracking for the trigger point. */
  recordCatchUp: () => Promise<StreakInfo>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setSettings: (partial: Partial<AppSettings>) => Promise<void>;
  /** Resolve a free-text city string ("Los Angeles, CA") against the bundled gazetteer, without
   * persisting anything — the caller decides whether to save it via setSettings. Returns null when
   * no match is found. */
  resolveHomeLocation: (query: string) => Promise<{ label: string; lat: number; lon: number } | null>;

  // AI relevance filtering. The key itself never crosses to the renderer — getAiConfig reports only
  // whether one is configured.
  getAiConfig: () => Promise<AiConfig>;
  setAiFilteringEnabled: (enabled: boolean) => Promise<void>;
  /** Validate a key (one tiny Gemini call), and on success store it and turn AI filtering on. */
  saveGeminiApiKey: (key: string) => Promise<SaveKeyResult>;

  // Change-notification push (main -> renderer). Implemented directly on ipcRenderer in preload,
  // not a request/response invoke.
  onDataChanged: (listener: (event: DataChangeEvent) => void) => () => void;
}
