import type {
  Article,
  ArticleListParams,
  CatchUpApi,
  Channel,
  DataChangeEvent,
} from '../../ipc-contract';

// --- Desktop build: talk to the Electron bridge exactly as before ------------------------------

function getBridge(): CatchUpApi {
  if (typeof window === 'undefined' || !window.api) {
    throw new Error('Catch Up cannot reach the desktop bridge — are you running outside Electron?');
  }
  return window.api;
}

const electronApi: CatchUpApi = {
  getOnboardingStatus: () => getBridge().getOnboardingStatus(),
  completeOnboarding: (names) => getBridge().completeOnboarding(names),

  getChannels: () => getBridge().getChannels(),
  createChannel: (name) => getBridge().createChannel(name),
  renameChannel: (channelId, name) => getBridge().renameChannel(channelId, name),
  deleteChannel: (channelId) => getBridge().deleteChannel(channelId),
  reorderChannel: (channelId, direction) => getBridge().reorderChannel(channelId, direction),
  setChannelOrder: (orderedIds) => getBridge().setChannelOrder(orderedIds),
  setChannelPause: (channelId, hours) => getBridge().setChannelPause(channelId, hours),
  clearChannel: (channelId) => getBridge().clearChannel(channelId),

  addSubchannel: (channelId, name) => getBridge().addSubchannel(channelId, name),
  renameSubchannel: (channelId, subchannelId, name) =>
    getBridge().renameSubchannel(channelId, subchannelId, name),
  deleteSubchannel: (channelId, subchannelId) => getBridge().deleteSubchannel(channelId, subchannelId),

  getArticles: (params) => getBridge().getArticles(params),
  refreshChannel: (channelId) => getBridge().refreshChannel(channelId),
  refreshAll: () => getBridge().refreshAll(),
  getProviderStatus: () => getBridge().getProviderStatus(),

  toggleBookmark: (articleId, channelId) => getBridge().toggleBookmark(articleId, channelId),
  getBookmarksByChannel: () => getBridge().getBookmarksByChannel(),

  markArticleRead: (articleId, channelId) => getBridge().markArticleRead(articleId, channelId),
  markArticleUnread: (articleId, channelId) => getBridge().markArticleUnread(articleId, channelId),
  getRandomArticle: (excludeArticleId) => getBridge().getRandomArticle(excludeArticleId),

  getStreak: () => getBridge().getStreak(),
  recordCatchUp: () => getBridge().recordCatchUp(),

  getSettings: () => getBridge().getSettings(),
  setSettings: (partial) => getBridge().setSettings(partial),
  resolveHomeLocation: (query) => getBridge().resolveHomeLocation(query),

  getAiConfig: () => getBridge().getAiConfig(),
  setAiFilteringEnabled: (enabled) => getBridge().setAiFilteringEnabled(enabled),
  saveGeminiApiKey: (key) => getBridge().saveGeminiApiKey(key),

  onDataChanged: (listener) => getBridge().onDataChanged(listener),
};

// --- Web build: talk to the hosted backend over plain HTTP --------------------------------------

const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed: ${res.status}`);
  return body as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
}

/** Local (browser) calendar date, "YYYY-MM-DD" — same format/contract as the streak math in
 * server/stores/dataStore.ts's recordCatchUp. Computed here, not on the server, since the server
 * has no single "the user's timezone" to derive it from. */
function localDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every onDataChanged subscriber shares ONE polling loop (not one interval per subscriber) — since
// several hooks/components call onDataChanged independently, a naive per-subscriber interval would
// multiply the same network calls needlessly. Polling, not a push, because this is a personal news
// app where a ~20s staleness window is genuinely fine — see the deployment plan's reasoning.
const POLL_INTERVAL_MS = 20_000;
const listeners = new Set<(event: DataChangeEvent) => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  try {
    const channels = await request<Channel[]>('/channels');
    const events: DataChangeEvent[] = [
      { type: 'channels' },
      { type: 'settings' },
      { type: 'streak' },
      { type: 'bookmarks' },
      { type: 'readState' },
      ...channels.flatMap((c): DataChangeEvent[] => [
        { type: 'articles', channelId: c.id },
        { type: 'subchannels', channelId: c.id },
      ]),
    ];
    for (const event of events) for (const listener of listeners) listener(event);
  } catch {
    // A network hiccup shouldn't break polling — just try again next tick, same "never let a
    // background sync failure break the app" spirit as the rest of this codebase.
  }
}

function webOnDataChanged(listener: (event: DataChangeEvent) => void): () => void {
  listeners.add(listener);
  if (!pollTimer) pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

function articlesQuery(params: ArticleListParams): string {
  const qs = new URLSearchParams({ channelId: params.channelId });
  if (params.subchannelId) qs.set('subchannelId', params.subchannelId);
  if (params.limit) qs.set('limit', String(params.limit));
  return qs.toString();
}

const webApi: CatchUpApi = {
  getOnboardingStatus: () => request('/onboarding'),
  completeOnboarding: (names) => post('/onboarding/complete', { names }),

  getChannels: () => request('/channels'),
  createChannel: (name) => post('/channels', { name }),
  renameChannel: (channelId, name) => post(`/channels/${channelId}/rename`, { name }),
  deleteChannel: (channelId) => request(`/channels/${channelId}`, { method: 'DELETE' }),
  reorderChannel: (channelId, direction) => post(`/channels/${channelId}/reorder`, { direction }),
  setChannelOrder: (orderedIds) => post('/channels/order', { orderedIds }),
  setChannelPause: (channelId, duration) => post(`/channels/${channelId}/pause`, { duration }),
  clearChannel: (channelId) => post(`/channels/${channelId}/clear`),

  addSubchannel: (channelId, name) => post(`/channels/${channelId}/subchannels`, { name }),
  renameSubchannel: (channelId, subchannelId, name) =>
    post(`/channels/${channelId}/subchannels/${subchannelId}/rename`, { name }),
  deleteSubchannel: (channelId, subchannelId) =>
    request(`/channels/${channelId}/subchannels/${subchannelId}`, { method: 'DELETE' }),

  getArticles: (params) => request(`/articles?${articlesQuery(params)}`),
  refreshChannel: (channelId) => post(`/channels/${channelId}/refresh`),
  refreshAll: () => post('/refresh-all'),
  getProviderStatus: () => request('/provider-status'),

  toggleBookmark: (articleId, channelId) => post('/bookmarks/toggle', { articleId, channelId }),
  getBookmarksByChannel: () => request('/bookmarks'),

  markArticleRead: (articleId) => post(`/articles/${articleId}/read`),
  markArticleUnread: (articleId) => post(`/articles/${articleId}/unread`),
  getRandomArticle: (excludeArticleId) =>
    request<Article | null>(`/random-article${excludeArticleId ? `?exclude=${encodeURIComponent(excludeArticleId)}` : ''}`),

  getStreak: () => request('/streak'),
  recordCatchUp: () => post('/streak/catch-up', { today: localDateString() }),

  getSettings: () => request('/settings'),
  setSettings: (partial) => post('/settings', partial),
  resolveHomeLocation: (query) => post('/settings/resolve-location', { query }),

  getAiConfig: () => request('/ai-config'),
  setAiFilteringEnabled: (enabled) => post('/ai-config/enabled', { enabled }),
  saveGeminiApiKey: (key) => post('/ai-config/key', { key }),

  onDataChanged: webOnDataChanged,
};

// --- Pick the right implementation once, at module load ----------------------------------------

export const api: CatchUpApi = typeof window !== 'undefined' && window.api ? electronApi : webApi;
