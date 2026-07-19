import type { CatchUpApi } from '../../ipc-contract';

function getBridge(): CatchUpApi {
  if (typeof window === 'undefined' || !window.api) {
    throw new Error('Catch Up cannot reach the desktop bridge — are you running outside Electron?');
  }
  return window.api;
}

export const api: CatchUpApi = {
  getOnboardingStatus: () => getBridge().getOnboardingStatus(),
  completeOnboarding: (names) => getBridge().completeOnboarding(names),

  getChannels: () => getBridge().getChannels(),
  createChannel: (name) => getBridge().createChannel(name),
  renameChannel: (channelId, name) => getBridge().renameChannel(channelId, name),
  deleteChannel: (channelId) => getBridge().deleteChannel(channelId),
  reorderChannel: (channelId, direction) => getBridge().reorderChannel(channelId, direction),

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

  getSettings: () => getBridge().getSettings(),
  setSettings: (partial) => getBridge().setSettings(partial),

  onDataChanged: (listener) => getBridge().onDataChanged(listener),
};
