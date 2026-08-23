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

import { runChannel, runAll } from './refreshAgent';
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
    // relevanceScore 3 = termSnippet (2, "wildfires" named only in the snippet) + includeSnippet (1,
    // the same word double-counts as the topic channel's own include keyword — see relevance.ts's
    // W.localityNear comment). Calgary-to-Banff is ~128km, inside the deliberately neutral middle
    // band between LOCALITY_NEAR_KM (100) and LOCALITY_FAR_KM (500), so locality adds nothing here.
    expect(keptArticles).toEqual([{ ...BANFF_STORY, relevanceScore: 3 }]);
  });

  it('keeps the same story via the real pipeline when no home location is configured', async () => {
    vi.mocked(runProviders).mockResolvedValue([BANFF_STORY]);
    const deps = { dataStore: fakeDataStore(wildfiresChannel(), null), articlesCache, classificationStore, broadcast };

    await runChannel(deps, 'ch1');

    const [, , keptArticles] = mergeSpy.mock.calls[0];
    expect(keptArticles).toEqual([{ ...BANFF_STORY, relevanceScore: 3 }]);
  });

  it('returns a not-found result for an unknown channel id without touching providers', async () => {
    vi.mocked(runProviders).mockResolvedValue([BANFF_STORY]);
    const deps = { dataStore: fakeDataStore(wildfiresChannel(), LA), articlesCache, classificationStore, broadcast };

    const result = await runChannel(deps, 'does-not-exist');

    expect(result.errors).toEqual(['Channel not found: does-not-exist']);
    expect(runProviders).not.toHaveBeenCalled();
  });
});

describe('runAll — channel-level stagger (CHANNEL_STAGGER_FACTOR)', () => {
  // A distinct id set from the runChannel suite above — channels here don't need real locality
  // behavior, just distinct ids for the hash-based rotation to spread across.
  function manyChannels(count: number): Channel[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `stagger-ch-${i}`,
      name: `Channel ${i}`,
      slug: `channel-${i}`,
      createdAt: new Date().toISOString(),
      sortOrder: i,
      subchannels: [],
      pausedUntil: null,
      pausedLabel: null,
    }));
  }

  function fakeMultiDataStore(channels: Channel[]): DataStore {
    return {
      getChannels: () => channels,
      isChannelPaused: () => false,
      getSettings: () => ({
        defaultViewMode: 'list',
        refreshIntervalMinutes: 30,
        theme: 'light',
        rollTheDiceChannelIds: null,
        maxStoriesShown: 25,
        homeLocation: null,
      }),
      getAiProvider: () => null,
    } as unknown as DataStore;
  }

  it('runs only a subset of channels per cycle, and covers every channel exactly once over one full rotation', async () => {
    vi.mocked(runProviders).mockResolvedValue([]);
    const channels = manyChannels(22); // 2 full periods of the 11-cycle rotation
    const deps = {
      dataStore: fakeMultiDataStore(channels),
      articlesCache: { merge: vi.fn(() => 0) } as unknown as ArticlesCache,
      classificationStore: {} as unknown as ClassificationStore,
      broadcast: vi.fn() as (event: DataChangeEvent) => void,
    };

    // backgroundCycle is module-private and keeps incrementing across calls, so this doesn't
    // assume any particular starting value — 11 CONSECUTIVE calls always complete exactly one full
    // sweep of the rotation regardless of where the counter happened to start.
    const perCycleTouched: Set<string>[] = [];
    for (let i = 0; i < 11; i++) {
      vi.mocked(runProviders).mockClear();
      await runAll(deps);
      perCycleTouched.push(new Set(vi.mocked(runProviders).mock.calls.map((c) => c[0].channelId)));
    }

    // Genuine staggering: no single cycle touches every channel.
    for (const touched of perCycleTouched) {
      expect(touched.size).toBeLessThan(channels.length);
      expect(touched.size).toBeGreaterThan(0);
    }

    // Full coverage: every channel is due on exactly one of the 11 cycles.
    const union = new Set(perCycleTouched.flatMap((s) => [...s]));
    expect(union.size).toBe(channels.length);
  });

  it('a manual runChannel call is never subject to channel-level staggering', async () => {
    // Regression guard for the thing this feature must never break: a manual "Refresh" click (or a
    // newly created channel) calls runChannel directly, bypassing runAll's loop entirely, so it
    // must always fetch regardless of whether this channel would currently be "due".
    vi.mocked(runProviders).mockResolvedValue([]);
    const channel = manyChannels(1)[0];
    const deps = {
      dataStore: fakeMultiDataStore([channel]),
      articlesCache: { merge: vi.fn(() => 0) } as unknown as ArticlesCache,
      classificationStore: {} as unknown as ClassificationStore,
      broadcast: vi.fn() as (event: DataChangeEvent) => void,
    };

    for (let i = 0; i < 11; i++) {
      vi.mocked(runProviders).mockClear();
      await runChannel(deps, channel.id);
      expect(runProviders).toHaveBeenCalledTimes(1);
    }
  });
});
