import { ipcMain, BrowserWindow, nativeTheme } from 'electron';
import type { DataStore } from './dataStore';
import type { ArticlesCache } from './articlesCache';
import type { ClassificationStore } from './classificationStore';
import { runAll, runChannel, type RefreshDeps } from './refreshAgent';
import { getProviderStatus } from './providers/registry';
import { pingModel, pingGroq, pingOllama } from './providers/classifier';
import type { Article, ArticleListParams, AiProvider, DataChangeEvent } from '../ipc-contract';
import type { CachedArticle } from './articlesCache';
import { resolveCity } from './locality/gazetteer';

export interface HandlerDeps {
  dataStore: DataStore;
  articlesCache: ArticlesCache;
  classificationStore: ClassificationStore;
}

export function broadcast(event: DataChangeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('catchup:data-changed', event);
  }
}

function toArticle(cached: CachedArticle, dataStore: DataStore): Article {
  return {
    ...cached,
    bookmarked: dataStore.isBookmarked(cached.id),
    read: dataStore.isRead(cached.id),
  };
}

export function registerIpcHandlers({ dataStore, articlesCache, classificationStore }: HandlerDeps): void {
  const refreshDeps: RefreshDeps = { dataStore, articlesCache, classificationStore, broadcast };

  ipcMain.handle('getOnboardingStatus', () => dataStore.getOnboardingStatus());
  ipcMain.handle('completeOnboarding', (_e, names: string[]) => {
    const channels = dataStore.completeOnboarding(names);
    broadcast({ type: 'channels' });
    return channels;
  });

  ipcMain.handle('getChannels', () => dataStore.getChannels());
  ipcMain.handle('createChannel', (_e, name: string) => {
    const channel = dataStore.createChannel(name);
    broadcast({ type: 'channels' });
    void runChannel(refreshDeps, channel.id);
    return channel;
  });
  ipcMain.handle('renameChannel', (_e, channelId: string, name: string) => {
    dataStore.renameChannel(channelId, name);
    broadcast({ type: 'channels' });
  });
  ipcMain.handle('deleteChannel', (_e, channelId: string) => {
    dataStore.deleteChannel(channelId);
    articlesCache.deleteChannel(channelId);
    broadcast({ type: 'channels' });
    broadcast({ type: 'bookmarks' });
  });
  ipcMain.handle('reorderChannel', (_e, channelId: string, direction: 'up' | 'down') => {
    dataStore.reorderChannel(channelId, direction);
    broadcast({ type: 'channels' });
  });
  ipcMain.handle('setChannelOrder', (_e, orderedIds: string[]) => {
    dataStore.setChannelOrder(orderedIds);
    broadcast({ type: 'channels' });
  });
  ipcMain.handle('setChannelPause', (_e, channelId: string, duration: number | 'forever' | null) => {
    dataStore.setChannelPause(channelId, duration);
    broadcast({ type: 'channels' });
  });

  ipcMain.handle('addSubchannel', (_e, channelId: string, name: string) => {
    const sub = dataStore.addSubchannel(channelId, name);
    broadcast({ type: 'subchannels', channelId });
    void runChannel(refreshDeps, channelId);
    return sub;
  });
  ipcMain.handle('renameSubchannel', (_e, channelId: string, subchannelId: string, name: string) => {
    dataStore.renameSubchannel(channelId, subchannelId, name);
    broadcast({ type: 'subchannels', channelId });
  });
  ipcMain.handle('deleteSubchannel', (_e, channelId: string, subchannelId: string) => {
    dataStore.deleteSubchannel(channelId, subchannelId);
    broadcast({ type: 'subchannels', channelId });
  });

  ipcMain.handle('getArticles', (_e, params: ArticleListParams) => {
    // channelIds (The Pool's multi-channel path) exists for the web build, where it collapses one
    // request per channel into one. Desktop reads from an in-memory cache where that fan-out cost
    // nothing, so this just concatenates — same result, no network involved either way.
    //
    // params.limit here is the caller's GLOBAL budget (usePoolArticles.ts sends
    // MAX_PER_CHANNEL * channels.length), not a per-channel one. Passing it straight through to
    // each channel's own getArticles(id, null, limit) would let every channel contribute up to its
    // *entire* cache (typically ~300 articles), so a single busy channel could crowd quieter ones
    // out of the merged result entirely — a real behavior change from the app's original "every
    // channel gets its fair share" Pool, which this call is not meant to alter. Dividing the budget
    // back out per channel restores that guarantee: with the caller's own math, this recovers
    // exactly MAX_PER_CHANNEL when every requested channel is included.
    if (params.channelIds?.length) {
      const perChannelLimit = params.limit ? Math.ceil(params.limit / params.channelIds.length) : undefined;
      const merged = params.channelIds
        .flatMap((id) => articlesCache.getArticles(id, null, perChannelLimit))
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        .slice(0, params.limit ?? undefined);
      return { articles: merged.map((a) => toArticle(a, dataStore)) };
    }
    const cached = articlesCache.getArticles(params.channelId, params.subchannelId, params.limit);
    return { articles: cached.map((a) => toArticle(a, dataStore)) };
  });
  // Same counts the web build gets from its dedicated endpoint — computed straight off the
  // in-memory cache here, since desktop has no network cost to avoid.
  ipcMain.handle('getChannelCounts', () => {
    const counts: Record<string, { unread: number; recent: number }> = {};
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const channel of dataStore.getChannels()) {
      const unread = articlesCache.getArticles(channel.id, null).filter((a) => !dataStore.isRead(a.id));
      counts[channel.id] = {
        unread: unread.length,
        recent: unread.filter((a) => new Date(a.publishedAt).getTime() > dayAgo).length,
      };
    }
    return counts;
  });
  ipcMain.handle('refreshChannel', (_e, channelId: string) => runChannel(refreshDeps, channelId));
  ipcMain.handle('refreshAll', () => runAll(refreshDeps));
  ipcMain.handle('getProviderStatus', () => getProviderStatus());

  ipcMain.handle('toggleBookmark', (_e, articleId: string, channelId: string) => {
    const isBookmarked = dataStore.isBookmarked(articleId);
    let result: { bookmarked: boolean };
    if (isBookmarked) {
      result = dataStore.toggleBookmark(articleId, channelId);
    } else {
      const cached = articlesCache.getArticleById(channelId, articleId);
      result = dataStore.toggleBookmark(articleId, channelId, cached ? { ...cached } : undefined);
    }
    broadcast({ type: 'bookmarks', channelId });
    return result;
  });
  ipcMain.handle('getBookmarksByChannel', () => dataStore.getBookmarksByChannel());

  ipcMain.handle('markArticleRead', (_e, articleId: string, channelId: string) => {
    dataStore.markRead(articleId);
    broadcast({ type: 'readState', channelId });
  });
  ipcMain.handle('markArticleUnread', (_e, articleId: string, channelId: string) => {
    dataStore.markUnread(articleId);
    broadcast({ type: 'readState', channelId });
  });
  ipcMain.handle('clearChannel', (_e, channelId: string) => {
    // Mark every cached story in the channel read — a manual "clear" (no celebration).
    const ids = articlesCache.getArticles(channelId, null).map((a) => a.id);
    dataStore.markManyRead(ids);
    broadcast({ type: 'readState', channelId });
  });
  ipcMain.handle('getRandomArticle', (_e, excludeArticleId?: string) => {
    // Copy — getReadArticleIds() returns the store's live internal Set by reference, and adding
    // excludeArticleId to it directly would incorrectly mark that article "read" in memory.
    const exclude = new Set(dataStore.getReadArticleIds());
    if (excludeArticleId) exclude.add(excludeArticleId);
    const cached = articlesCache.getRandomArticle(exclude, dataStore.getSettings().rollTheDiceChannelIds);
    return cached ? toArticle(cached, dataStore) : null;
  });

  ipcMain.handle('getStreak', () => dataStore.getStreak());
  ipcMain.handle('recordCatchUp', () => {
    const streak = dataStore.recordCatchUp();
    broadcast({ type: 'streak' });
    return streak;
  });

  ipcMain.handle('getSettings', () => dataStore.getSettings());
  ipcMain.handle('setSettings', (_e, partial) => {
    dataStore.setSettings(partial);
    if (partial.theme) nativeTheme.themeSource = partial.theme;
    broadcast({ type: 'settings' });
  });
  ipcMain.handle('resolveHomeLocation', (_e, query: string) => resolveCity(query));

  ipcMain.handle('getAiConfig', () => ({
    provider: dataStore.getAiProvider(),
    // A key from .env (dev) counts as configured too, so it won't needlessly prompt the modal.
    geminiKeyConfigured: dataStore.hasGeminiApiKey() || !!process.env.GEMINI_API_KEY?.trim(),
    groqKeyConfigured: dataStore.hasGroqApiKey() || !!process.env.GROQ_API_KEY?.trim(),
    ollamaModel: dataStore.getOllamaModel(),
  }));
  ipcMain.handle('setAiProvider', (_e, provider: AiProvider | null) => {
    dataStore.setAiProvider(provider);
    broadcast({ type: 'settings' });
  });
  ipcMain.handle('saveGeminiApiKey', async (_e, key: string) => {
    const result = await pingModel(key);
    if (!result.ok) return result;
    // Valid — persist it, apply to the running process so it works without a restart, and switch to it.
    dataStore.setGeminiApiKey(key);
    dataStore.setAiProvider('gemini');
    process.env.GEMINI_API_KEY = key.trim();
    broadcast({ type: 'settings' });
    return { ok: true };
  });
  ipcMain.handle('saveGroqApiKey', async (_e, key: string) => {
    const result = await pingGroq(key);
    if (!result.ok) return result;
    dataStore.setGroqApiKey(key);
    dataStore.setAiProvider('groq');
    process.env.GROQ_API_KEY = key.trim();
    broadcast({ type: 'settings' });
    return { ok: true };
  });
  ipcMain.handle('setOllamaModel', (_e, model: string) => {
    dataStore.setOllamaModel(model);
    dataStore.setAiProvider('ollama');
    broadcast({ type: 'settings' });
  });
  ipcMain.handle('pingOllama', (_e, model: string) => pingOllama(model));
}
