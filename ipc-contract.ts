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
  lastOpenedDate: string | null;
}

export type DataChangeEvent =
  | { type: 'channels' }
  | { type: 'subchannels'; channelId: string }
  | { type: 'articles'; channelId: string }
  | { type: 'bookmarks'; channelId?: string }
  | { type: 'readState'; channelId?: string }
  | { type: 'settings' };

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

  // Settings
  getSettings: () => Promise<AppSettings>;
  setSettings: (partial: Partial<AppSettings>) => Promise<void>;

  // Change-notification push (main -> renderer). Implemented directly on ipcRenderer in preload,
  // not a request/response invoke.
  onDataChanged: (listener: (event: DataChangeEvent) => void) => () => void;
}
