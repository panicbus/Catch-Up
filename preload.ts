import { contextBridge, ipcRenderer } from 'electron';
import type { CatchUpApi, DataChangeEvent } from './ipc-contract';

const api: CatchUpApi = {
  getOnboardingStatus: () => ipcRenderer.invoke('getOnboardingStatus'),
  completeOnboarding: (names) => ipcRenderer.invoke('completeOnboarding', names),

  getChannels: () => ipcRenderer.invoke('getChannels'),
  createChannel: (name) => ipcRenderer.invoke('createChannel', name),
  renameChannel: (channelId, name) => ipcRenderer.invoke('renameChannel', channelId, name),
  deleteChannel: (channelId) => ipcRenderer.invoke('deleteChannel', channelId),
  reorderChannel: (channelId, direction) => ipcRenderer.invoke('reorderChannel', channelId, direction),

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

  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSettings: (partial) => ipcRenderer.invoke('setSettings', partial),

  onDataChanged: (listener) => {
    const channel = 'catchup:data-changed';
    const wrapped = (_: unknown, event: DataChangeEvent) => listener(event);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('api', api);
