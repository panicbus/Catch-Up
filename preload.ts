import { contextBridge, ipcRenderer } from 'electron';
import type { CatchUpApi, DataChangeEvent, Theme } from './ipc-contract';

// Stamp the theme onto <html> synchronously, before the page's own scripts run — an async fetch
// (even one that resolves in a handful of milliseconds) paints once with the wrong theme first and
// is exactly the flash this is here to prevent. Never allow this to take down the rest of the
// bridge below — worst case here is one flashed paint, not a broken app.
try {
  const initialTheme = ipcRenderer.sendSync('theme:getInitialSync') as Theme;
  document.documentElement.setAttribute('data-theme', initialTheme);
} catch (e) {
  console.error('[preload] theme bootstrap failed', e);
}

const api: CatchUpApi = {
  getOnboardingStatus: () => ipcRenderer.invoke('getOnboardingStatus'),
  completeOnboarding: (names) => ipcRenderer.invoke('completeOnboarding', names),

  getChannels: () => ipcRenderer.invoke('getChannels'),
  createChannel: (name) => ipcRenderer.invoke('createChannel', name),
  renameChannel: (channelId, name) => ipcRenderer.invoke('renameChannel', channelId, name),
  deleteChannel: (channelId) => ipcRenderer.invoke('deleteChannel', channelId),
  reorderChannel: (channelId, direction) => ipcRenderer.invoke('reorderChannel', channelId, direction),
  setChannelOrder: (orderedIds) => ipcRenderer.invoke('setChannelOrder', orderedIds),
  setChannelPause: (channelId, hours) => ipcRenderer.invoke('setChannelPause', channelId, hours),
  clearChannel: (channelId) => ipcRenderer.invoke('clearChannel', channelId),

  addSubchannel: (channelId, name) => ipcRenderer.invoke('addSubchannel', channelId, name),
  renameSubchannel: (channelId, subchannelId, name) =>
    ipcRenderer.invoke('renameSubchannel', channelId, subchannelId, name),
  deleteSubchannel: (channelId, subchannelId) =>
    ipcRenderer.invoke('deleteSubchannel', channelId, subchannelId),

  getArticles: (params) => ipcRenderer.invoke('getArticles', params),
  refreshChannel: (channelId) => ipcRenderer.invoke('refreshChannel', channelId),
  refreshAll: () => ipcRenderer.invoke('refreshAll'),
  getProviderStatus: () => ipcRenderer.invoke('getProviderStatus'),

  toggleBookmark: (articleId, channelId) => ipcRenderer.invoke('toggleBookmark', articleId, channelId),
  getBookmarksByChannel: () => ipcRenderer.invoke('getBookmarksByChannel'),

  markArticleRead: (articleId, channelId) => ipcRenderer.invoke('markArticleRead', articleId, channelId),
  markArticleUnread: (articleId, channelId) => ipcRenderer.invoke('markArticleUnread', articleId, channelId),
  getRandomArticle: (excludeArticleId) => ipcRenderer.invoke('getRandomArticle', excludeArticleId),

  getStreak: () => ipcRenderer.invoke('getStreak'),
  recordCatchUp: () => ipcRenderer.invoke('recordCatchUp'),

  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSettings: (partial) => ipcRenderer.invoke('setSettings', partial),

  getAiConfig: () => ipcRenderer.invoke('getAiConfig'),
  setAiFilteringEnabled: (enabled) => ipcRenderer.invoke('setAiFilteringEnabled', enabled),
  saveGeminiApiKey: (key) => ipcRenderer.invoke('saveGeminiApiKey', key),

  onDataChanged: (listener) => {
    const channel = 'catchup:data-changed';
    const wrapped = (_: unknown, event: DataChangeEvent) => listener(event);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('api', api);
