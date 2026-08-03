import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Channel, AppSettings, DataChangeEvent } from '../ipc-contract';
import type { DataStore } from './dataStore';
import type { ArticlesCache } from './articlesCache';
import type { ClassificationStore } from './classificationStore';
import type { FetchedArticle } from './providers/types';
import { resolveCity } from './locality/gazetteer';

// Mocks the actual network-calling provider layer so this exercises the REAL runChannel()
// orchestration (dataStore.getSettings().homeLocation -> filterRelevant -> filterByRelevance ->
// the locality signal) without hitting live provider APIs. This is the one gap direct
// relevance.test.ts calls couldn't close: everything up to here was tested by constructing a
// RelevanceContext by hand, never by actually running the pipeline that builds one.
vi.mock('./providers/registry', () => ({
  runProviders: vi.fn(),
  getProviderStatus: vi.fn(() => []),
}));

import { runChannel } from './refreshAgent';
import { runProviders } from './providers/registry';

const LA = { query: 'Los Angeles, CA', ...resolveCity('Los Angeles, CA')! };
const CALGARY = { query: 'Calgary, AB', ...resolveCity('Calgary, AB')! };

const BANFF_STORY: FetchedArticle = {
  url: 'https://example.com/banff-fire-ban',
  title: 'Fire ban in effect for Banff, Yoho, and Kootenay national parks',
  snippet: 'These fire bans will be implemented to reduce the likelihood of human-caused wildfires.',
  source: 'rmoutlook',
  publishedAt: new Date().toISOString(),
  imageUrl: null,
  section: null,
  tags: null,
  provider: 'googlenewsrss',
};

function wildfiresChannel(): Channel {
  return {
    id: 'ch1',
    name: 'Wildfires',
    slug: 'wildfires',
    createdAt: new Date().toISOString(),
    sortOrder: 0,
    subchannels: [],
    pausedUntil: null,
    pausedLabel: null,
  };
}

function fakeDataStore(channel: Channel, homeLocation: AppSettings['homeLocation']): DataStore {
  return {
    getChannels: () => [channel],
    getSettings: () => ({
      defaultViewMode: 'list',
      refreshIntervalMinutes: 30,
      theme: 'light',
      rollTheDiceChannelIds: null,
      maxStoriesShown: 25,
      homeLocation,
    }),
    getAiProvider: () => null,
  } as unknown as DataStore;
}

describe('runChannel — end-to-end locality threading (mocked providers, real orchestration)', () => {
  let mergeSpy: ReturnType<typeof vi.fn>;
  let articlesCache: ArticlesCache;
  let classificationStore: ClassificationStore;
  let broadcast: (event: DataChangeEvent) => void;

  beforeEach(() => {
    vi.mocked(runProviders).mockReset();
    mergeSpy = vi.fn(() => 0);
    articlesCache = { merge: mergeSpy } as unknown as ArticlesCache;
    classificationStore = {} as unknown as ClassificationStore;
    broadcast = vi.fn() as (event: DataChangeEvent) => void;
  });

  it('drops the far, weak-evidence story via the real pipeline when home is set far away', async () => {
    vi.mocked(runProviders).mockResolvedValue([BANFF_STORY]);
    const deps = { dataStore: fakeDataStore(wildfiresChannel(), LA), articlesCache, classificationStore, broadcast };

    await runChannel(deps, 'ch1');

    expect(mergeSpy).toHaveBeenCalledTimes(1);
    const [, , keptArticles] = mergeSpy.mock.calls[0];
    expect(keptArticles).toEqual([]);
  });

  it('keeps the same story via the real pipeline when home is set nearby', async () => {
    vi.mocked(runProviders).mockResolvedValue([BANFF_STORY]);
    const deps = { dataStore: fakeDataStore(wildfiresChannel(), CALGARY), articlesCache, classificationStore, broadcast };

    await runChannel(deps, 'ch1');

    expect(mergeSpy).toHaveBeenCalledTimes(1);
    const [, , keptArticles] = mergeSpy.mock.calls[0];
    expect(keptArticles).toEqual([BANFF_STORY]);
  });

  it('keeps the same story via the real pipeline when no home location is configured', async () => {
    vi.mocked(runProviders).mockResolvedValue([BANFF_STORY]);
    const deps = { dataStore: fakeDataStore(wildfiresChannel(), null), articlesCache, classificationStore, broadcast };

    await runChannel(deps, 'ch1');

    const [, , keptArticles] = mergeSpy.mock.calls[0];
    expect(keptArticles).toEqual([BANFF_STORY]);
  });

  it('returns a not-found result for an unknown channel id without touching providers', async () => {
    vi.mocked(runProviders).mockResolvedValue([BANFF_STORY]);
    const deps = { dataStore: fakeDataStore(wildfiresChannel(), LA), articlesCache, classificationStore, broadcast };

    const result = await runChannel(deps, 'does-not-exist');

    expect(result.errors).toEqual(['Channel not found: does-not-exist']);
    expect(runProviders).not.toHaveBeenCalled();
  });
});
