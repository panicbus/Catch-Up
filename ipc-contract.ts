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
  /** relevance.ts's additive keep/reject score at save time — see prisma/schema.prisma's
   * Article.relevanceScore comment. null for anything saved before this field existed. */
  relevanceScore: number | null;
  bookmarked: boolean;
  read: boolean;
}

export interface ArticleListParams {
  /** A single channel. Ignored when `channelIds` is set. */
  channelId: string;
  subchannelId?: string | null;
  limit?: number;
  /** Several channels at once, newest-first across all of them (The Pool). Set this INSTEAD of
   * relying on channelId — it exists so a cross-channel view is one request rather than one per
   * channel. `subchannelId` doesn't apply: The Pool never drills into subchannels. */
  channelIds?: string[];
  /** Defaults to 'newest' server-side when omitted — see SortMode. */
  sortMode?: SortMode;
}

/** Unread + recent counts per channel id, for the home tiles. Deliberately its own tiny endpoint
 * rather than something derived from a full article fetch — see articlesCache.getChannelCounts. */
export interface ChannelCountsResult {
  [channelId: string]: { unread: number; recent: number };
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

// --- Reader view (web only) -----------------------------------------------------------------
//
// Types only — deliberately NOT added to CatchUpApi below. There is no Electron path for this
// (see server/reader/'s own header comment for why); the web build calls GET
// /articles/:articleId/reader directly via src/services/api.ts's fetchReaderContent(), following
// the same outside-CatchUpApi precedent as revalidateNow() and the auth functions in
// src/services/auth.ts. Living here rather than a separate reader-contract.ts costs nothing extra
// to build (this file is already in every tsconfig's `include`) and this is already the de facto
// shared-type module — server/stores/articlesCache.ts imports Article from here today.
//
// The server never sends third-party HTML — see server/reader/extract.ts. It sends this small
// block model instead, which the renderer maps straight to real elements (ReaderBlocks.tsx), so
// there is no dangerouslySetInnerHTML anywhere in this path.

export interface ReaderRun {
  text: string;
  href?: string;
  em?: boolean;
  strong?: boolean;
}

export type ReaderBlock =
  | { type: 'p' | 'h2' | 'h3' | 'blockquote' | 'li'; runs: ReaderRun[] }
  | { type: 'img'; src: string; alt: string | null; caption: string | null };

export interface ReaderContent {
  ok: true;
  articleId: string;
  url: string;
  title: string;
  source: string;
  sourceDomain: string;
  byline: string | null;
  publishedAt: string;
  leadImageUrl: string | null;
  wordCount: number;
  blocks: ReaderBlock[];
  tier: 'guardian' | 'readability';
  /** Hit the block/char cap in extract.ts — the UI should end with "Continue on {source} ↗". */
  truncated: boolean;
  /** A soft-paywall marker ("subscribe to continue", etc.) was detected in the extracted text —
   * the UI should lead with Open original rather than presenting this as the complete story. */
  partial: boolean;
}

/** Every reason renders the same shape in ReaderOverlay: the article's existing snippet (already
 * on the card, no extra fetch) plus a one-line explanation plus a prominent Open original link.
 * There is no dead end in this path — see server/reader/index.ts for where each is thrown. */
export interface ReaderUnavailable {
  ok: false;
  reason: 'paywalled' | 'blocked' | 'unsupported' | 'too-short' | 'failed' | 'busy';
}

export type ReaderResponse = ReaderContent | ReaderUnavailable;

/** A user's own added news source — global to the account, not scoped to any one channel (every
 * channel draws from it, sorted by its own relevance gate — see server/customSources/sort.ts).
 * Web-only, same as the reader view above — see src/services/api.ts's standalone exports, not
 * part of CatchUpApi. */
export interface CustomSource {
  id: string;
  feedUrl: string;
  /** What the user actually pasted, for display — may differ from feedUrl when discovery found the
   * real feed at a different address (e.g. pasting a site's homepage, feed found at /feed/). */
  siteUrl: string;
  label: string;
  createdAt: string;
  lastFetchedAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** Set once consecutiveFailures crosses the threshold — null means active. Shown as a flagged
   * row with a Retry action rather than silently retried forever or silently dropped. */
  disabledAt: string | null;
}

/** What adding a source actually returns — either the created row, or a specific reason it
 * couldn't be added, each rendered as its own plain-language message in Settings. See
 * server/customSources/discover.ts for exactly what each reason means. */
export type AddCustomSourceResult =
  | { ok: true; source: CustomSource }
  | { ok: false; reason: 'invalid-url' | 'not-found' | 'unreachable' | 'empty' | 'duplicate' | 'limit-reached' };

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
/** 'newest' (the long-standing default) or 'relevance' — server-applied in both getArticles
 * implementations (relevanceScore desc, publishedAt desc as tiebreak), not a client-side re-sort,
 * so pagination/caps stay coherent with what's actually returned. */
export type SortMode = 'newest' | 'relevance';
export type Theme = 'light' | 'dark';

export interface AppSettings {
  defaultViewMode: ViewMode;
  /** Defaults to 'newest' — same "old data files just don't have it" fallback convention as every
   * other field here (see rollTheDiceChannelIds). */
  defaultSortMode: SortMode;
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
   * channels (e.g. a "Wildfires" channel showing a small far-away town's fire story) and, more
   * strongly, a handful of category channels (Politics/Business/Health/Science/Technology) where a
   * story confidently about a different country gets filtered out — see main/providers/relevance.ts.
   * Resolved against the bundled city gazetteer at save time — `query` is what the user typed,
   * `label`/`lat`/`lon`/`countryCode` are the resolved match. null = feature inactive (also how
   * pre-existing data files without this field behave once loaded). `countryCode` is optional
   * specifically for a home location saved before that field existed — same "old data just doesn't
   * have it" handling as everywhere else in this file (see rollTheDiceChannelIds above); re-saving
   * the location fills it in. */
  homeLocation: { query: string; label: string; lat: number; lon: number; countryCode?: string } | null;
  /** Publisher domains (e.g. "reuters.com") the user has explicitly marked as trusted — a mild
   * boost in relevance.ts's scoring. Always a plain array (unlike rollTheDiceChannelIds's
   * null-means-everything convention) since there's no "trust nothing" vs. "trust everything"
   * ambiguity here: empty simply means no boost applies to anyone yet. */
  trustedSourceDomains: string[];
  /** Daily digest email — off by default. Web-only (see DigestSetting.tsx's isWeb gate): sending
   * happens via a scheduled job against the hosted database, which a desktop-only account has no
   * row in at all. */
  digestEnabled: boolean;
  /** 0-23, the hour (in digestTimezone) to send at. Defaults to 7 (7am) — meaningless until
   * digestEnabled is true. */
  digestSendHour: number;
  /** IANA zone name (e.g. "America/Los_Angeles"), set automatically the moment digestEnabled is
   * first turned on (see DigestSetting.tsx) — null beforehand, same "not configured yet"
   * convention as homeLocation. */
  digestTimezone: string | null;
  /** Which channels the digest covers. Populated with every channel id at the moment digest is
   * first enabled, then user-editable — deliberately NOT a null-means-all sentinel like
   * rollTheDiceChannelIds, so the cron job never has to re-derive "all channels" itself. */
  digestChannelIds: string[];
  /** Send to a different address than the one signed in with. null = use the account's own email. */
  digestEmailOverride: string | null;
}

/** Ollama is desktop-only (the hosted server can't reach a model on the founder's own Mac) — the web
 * build never offers it, but the type isn't split in two since the web CatchUpApi implementation
 * still needs to type the shared surface. */
export type AiProvider = 'gemini' | 'groq' | 'ollama';

export interface AiConfig {
  /** null = AI filtering is off. */
  provider: AiProvider | null;
  /** Whether a Gemini API key is stored (the key itself is never sent to the renderer — only its
   * last 4 characters, below, so the Settings UI can confirm one is saved without exposing it). */
  geminiKeyConfigured: boolean;
  /** Whether a Groq API key is stored. */
  groqKeyConfigured: boolean;
  /** Last 4 characters of the stored Gemini key, e.g. for showing "••••••••ab12" — null when no
   * key (or an env-only key with nothing in the store) is configured. */
  geminiKeyLast4: string | null;
  /** Last 4 characters of the stored Groq key. */
  groqKeyLast4: string | null;
  /** The configured Ollama model name — meaningful on desktop only. */
  ollamaModel: string;
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
  /** Unread/recent counts for every channel in one call — what the home tiles actually need.
   * Desktop computes this locally from its in-memory cache; web hits a dedicated endpoint rather
   * than downloading every article just to count them. */
  getChannelCounts: () => Promise<ChannelCountsResult>;
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
  resolveHomeLocation: (query: string) => Promise<{ label: string; lat: number; lon: number; countryCode: string } | null>;

  // AI relevance filtering. Keys themselves never cross to the renderer — getAiConfig reports only
  // whether one is configured.
  getAiConfig: () => Promise<AiConfig>;
  /** Switch the active provider (or turn filtering off with null). Does not itself validate — that
   * only matters for Gemini/Groq, whose key-saving calls already validate before turning things on. */
  setAiProvider: (provider: AiProvider | null) => Promise<void>;
  /** Validate a key (one tiny Gemini call), and on success store it and switch to Gemini. */
  saveGeminiApiKey: (key: string) => Promise<SaveKeyResult>;
  /** Validate a key (one tiny Groq call), and on success store it and switch to Groq. */
  saveGroqApiKey: (key: string) => Promise<SaveKeyResult>;
  /** Store the Ollama model name and switch to Ollama. No live validation here (see pingOllama) —
   * this just saves the setting, matching the "plain editable field" design (not a model-list picker). */
  setOllamaModel: (model: string) => Promise<void>;
  /** Desktop-only: check Ollama is reachable and the named model is actually pulled. The web build
   * never renders anything that calls this (Ollama is never offered there), but the type is shared. */
  pingOllama: (model: string) => Promise<SaveKeyResult>;

  // Change-notification push (main -> renderer). Implemented directly on ipcRenderer in preload,
  // not a request/response invoke.
  onDataChanged: (listener: (event: DataChangeEvent) => void) => () => void;
}
