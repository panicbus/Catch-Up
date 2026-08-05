import type {
  Article,
  ArticleListParams,
  CatchUpApi,
  Channel,
  DataChangeEvent,
} from '../../ipc-contract';
import * as channelsStore from './channelsStore';

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
  setAiProvider: (provider) => getBridge().setAiProvider(provider),
  saveGeminiApiKey: (key) => getBridge().saveGeminiApiKey(key),
  saveGroqApiKey: (key) => getBridge().saveGroqApiKey(key),
  setOllamaModel: (model) => getBridge().setOllamaModel(model),
  pingOllama: (model) => getBridge().pingOllama(model),

  onDataChanged: (listener) => getBridge().onDataChanged(listener),
};

// --- Web build: talk to the hosted backend over plain HTTP --------------------------------------

const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  // A 401 used to mean "the stored shared password was rejected", and this cleared it and reloaded
  // so the gate could re-prompt. With no gate there's nothing to re-prompt for, and reloading on
  // every failed call would spin forever — so a 401 is now just an error like any other status.
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
let pollInFlight: Promise<void> | null = null;

async function poll(): Promise<void> {
  // Coalesce: revalidateNow() and the interval can both call this in close succession (e.g. a
  // mutation completes right as a tick fires) — share one in-flight request instead of firing two.
  if (pollInFlight) return pollInFlight;
  pollInFlight = doPoll();
  try {
    await pollInFlight;
  } finally {
    pollInFlight = null;
  }
}

async function doPoll(): Promise<void> {
  try {
    const channels = await request<Channel[]>('/channels');
    // Feed the shared channel store the same payload this call already fetched, rather than firing
    // a 'channels changed' event that would make every one of channelsStore's subscribers (there
    // used to be ~10 independent fetches) go fetch the exact same thing again. `changed` also gates
    // whether channels/subchannels events fire below — a poll where nothing actually changed
    // shouldn't make every channel-scoped listener reload for no reason.
    const changed = channelsStore.ingest(channels);
    const events: DataChangeEvent[] = [
      ...(changed ? [{ type: 'channels' } as const] : []),
      ...(changed ? channels.map((c): DataChangeEvent => ({ type: 'subchannels', channelId: c.id })) : []),
      { type: 'settings' },
      { type: 'streak' },
      { type: 'bookmarks' },
      { type: 'readState' },
      ...channels.map((c): DataChangeEvent => ({ type: 'articles', channelId: c.id })),
    ];
    for (const event of events) for (const listener of listeners) listener(event);
  } catch {
    // A network hiccup shouldn't break polling — just try again next tick, same "never let a
    // background sync failure break the app" spirit as the rest of this codebase.
  }
}

/** Whether the poll interval should be running at all: someone has to be listening AND the tab has
 * to be visible. A hidden tab polling every 20s forever was a real cost — it kept fetching (and
 * kept the database awake) all night for a tab left open on a phone or a second monitor. */
function syncPollTimer(): void {
  const shouldRun = listeners.size > 0 && (typeof document === 'undefined' || document.visibilityState === 'visible');
  if (shouldRun && !pollTimer) {
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  } else if (!shouldRun && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function webOnDataChanged(listener: (event: DataChangeEvent) => void): () => void {
  listeners.add(listener);
  syncPollTimer();
  return () => {
    listeners.delete(listener);
    syncPollTimer();
  };
}

/** How long revalidateNow() waits before actually polling, so a burst of mutations collapses into
 * one. Short enough to still feel immediate; long enough to absorb a rapid sequence of actions. */
const REVALIDATE_DEBOUNCE_MS = 600;
let revalidateTimer: ReturnType<typeof setTimeout> | null = null;

/** Ask for a poll right now instead of waiting for the next interval tick — for a web mutation that
 * just succeeded and shouldn't sit behind up to 20s of staleness before its effects (articles,
 * streak, bookmarks, etc. beyond what the mutation's own optimistic update already covers) show up.
 * A no-op on desktop, which gets real push notifications instead (main/ipcHandlers.ts's broadcast())
 * and has no poll loop to restart — so call sites never need to branch on which build they're in.
 *
 * Trailing-debounced: several call sites fire in quick succession (bookmarking, dismissing, and
 * previously every single story scrolled past), and each undebounced call was a full poll cycle —
 * one feed scroll could trigger dozens. Restarts the interval too, so this doesn't leave a redundant
 * tick moments later. */
export function revalidateNow(): void {
  if (typeof window !== 'undefined' && window.api) return;
  if (revalidateTimer) clearTimeout(revalidateTimer);
  revalidateTimer = setTimeout(() => {
    revalidateTimer = null;
    void poll();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    }
  }, REVALIDATE_DEBOUNCE_MS);
}

if (typeof document !== 'undefined') {
  // Stop polling entirely while the tab is hidden, and catch up on return — coming back to a
  // backgrounded tab shouldn't wait up to 20s to feel fresh.
  document.addEventListener('visibilitychange', () => {
    syncPollTimer();
    if (document.visibilityState === 'visible') revalidateNow();
  });
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
  setAiProvider: (provider) => post('/ai-config/provider', { provider }),
  saveGeminiApiKey: (key) => post('/ai-config/gemini-key', { key }),
  saveGroqApiKey: (key) => post('/ai-config/groq-key', { key }),
  // Ollama is desktop-only — the web Settings UI never offers it, so these are unreachable stubs.
  setOllamaModel: () => Promise.resolve(),
  pingOllama: () => Promise.resolve({ ok: false, error: 'Ollama is only available in the desktop app.' }),

  onDataChanged: webOnDataChanged,
};

// --- Pick the right implementation once, at module load ----------------------------------------

export const api: CatchUpApi = typeof window !== 'undefined' && window.api ? electronApi : webApi;
