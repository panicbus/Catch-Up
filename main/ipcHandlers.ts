import { ipcMain, BrowserWindow, nativeTheme } from 'electron';
import type { DataStore } from './dataStore';
import type { ArticlesCache } from './articlesCache';
import type { ClassificationStore } from './classificationStore';
import { runAll, runChannel, type RefreshDeps } from './refreshAgent';
import { getProviderStatus } from './providers/registry';
import { pingModel } from './providers/classifier';
import type { Article, ArticleListParams, DataChangeEvent } from '../ipc-contract';
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
    const cached = articlesCache.getArticles(params.channelId, params.subchannelId, params.limit);
    return { articles: cached.map((a) => toArticle(a, dataStore)) };
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
    enabled: dataStore.getAiEnabled(),
    // A key from .env (dev) counts as configured too, so it won't needlessly prompt the modal.
    keyConfigured: dataStore.hasGeminiApiKey() || !!process.env.GEMINI_API_KEY?.trim(),
  }));
  ipcMain.handle('setAiFilteringEnabled', (_e, enabled: boolean) => {
    dataStore.setAiEnabled(enabled);
    broadcast({ type: 'settings' });
  });
  ipcMain.handle('saveGeminiApiKey', async (_e, key: string) => {
    const result = await pingModel(key);
    if (!result.ok) return result;
    // Valid — persist it, apply to the running process so it works without a restart, and turn AI on.
    dataStore.setGeminiApiKey(key);
    dataStore.setAiEnabled(true);
    process.env.GEMINI_API_KEY = key.trim();
    broadcast({ type: 'settings' });
    return { ok: true };
  });
}
