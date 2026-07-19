import { ipcMain, BrowserWindow } from 'electron';
import type { DataStore } from './dataStore';
import type { ArticlesCache } from './articlesCache';
import { runAll, runChannel, type RefreshDeps } from './refreshAgent';
import { getProviderStatus } from './providers/registry';
import type { Article, ArticleListParams, DataChangeEvent } from '../ipc-contract';

export interface HandlerDeps {
  dataStore: DataStore;
  articlesCache: ArticlesCache;
}

export function broadcast(event: DataChangeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('catchup:data-changed', event);
  }
}

function toArticle(cached: ReturnType<ArticlesCache['getArticles']>[number], dataStore: DataStore): Article {
  return { ...cached, bookmarked: dataStore.isBookmarked(cached.id) };
}

export function registerIpcHandlers({ dataStore, articlesCache }: HandlerDeps): void {
  const refreshDeps: RefreshDeps = { dataStore, articlesCache, broadcast };

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
      const [cached] = articlesCache.getArticles(channelId, null, 10000).filter((a) => a.id === articleId);
      result = dataStore.toggleBookmark(articleId, channelId, cached ? { ...cached } : undefined);
    }
    broadcast({ type: 'bookmarks', channelId });
    return result;
  });
  ipcMain.handle('getBookmarksByChannel', () => dataStore.getBookmarksByChannel());

  ipcMain.handle('getSettings', () => dataStore.getSettings());
  ipcMain.handle('setSettings', (_e, partial) => {
    dataStore.setSettings(partial);
    broadcast({ type: 'settings' });
  });
}
