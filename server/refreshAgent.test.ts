import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Channel, AppSettings } from '../ipc-contract';
import type { AiSettings } from './stores/dataStore';

// Mocks every database-backed dependency so this exercises the REAL runAll/runChannel
// orchestration (in particular the channel-level stagger rotation) without touching Postgres —
// mirrors main/refreshAgent.test.ts's approach for the desktop twin of this file.
vi.mock('../main/providers/registry', () => ({
  runProviders: vi.fn(),
  getProviderStatus: vi.fn(() => []),
}));
vi.mock('./stores/dataStore', () => ({
  getChannels: vi.fn(),
  getSettings: vi.fn(),
  getAiSettings: vi.fn(),
}));
vi.mock('./stores/articlesCache', () => ({
  merge: vi.fn(),
  mergeGroups: vi.fn(),
}));
vi.mock('./stores/classificationStore', () => ({
  ServerClassificationStore: class {},
}));
vi.mock('./stores/providerBudget', () => {
  // A local stand-in, not the real module — the real one imports server/db.ts, which throws at
  // import time without a live DATABASE_URL. Never actually thrown in these tests (assertSearchBudget
  // always resolves), so it only needs to exist as a class runAll's `instanceof` check can see.
  class RateLimitedError extends Error {
    resetsAt = new Date();
  }
  return { assertSearchBudget: vi.fn(), recordSearches: vi.fn(), RateLimitedError };
});
vi.mock('./customSources/refresh', () => ({
  runCustomSources: vi.fn(),
}));

import { runAll, runChannel } from './refreshAgent';
import { runProviders } from '../main/providers/registry';
import * as dataStore from './stores/dataStore';
import * as articlesCache from './stores/articlesCache';

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

// Partial on purpose, same as main/refreshAgent.test.ts's fakeDataStore — runAll/runChannel only
// ever read homeLocation and trustedSourceDomains off this, so the rest of AppSettings's fields
// don't need real values, just a single cast (not one per call site) acknowledging the stub.
const FAKE_SETTINGS = {
  defaultViewMode: 'list',
  refreshIntervalMinutes: 30,
  theme: 'light',
  rollTheDiceChannelIds: null,
  maxStoriesShown: 25,
  homeLocation: null,
  trustedSourceDomains: [],
} as unknown as AppSettings;

const FAKE_AI_SETTINGS: AiSettings = { provider: null, geminiApiKey: null, groqApiKey: null, ollamaModel: '' };

beforeEach(() => {
  vi.mocked(runProviders).mockReset().mockResolvedValue([]);
  vi.mocked(dataStore.getSettings).mockReset().mockResolvedValue(FAKE_SETTINGS);
  vi.mocked(dataStore.getAiSettings).mockReset().mockResolvedValue(FAKE_AI_SETTINGS);
  vi.mocked(articlesCache.merge).mockReset().mockResolvedValue(0);
  vi.mocked(articlesCache.mergeGroups).mockReset().mockResolvedValue(0);
});

describe('runAll — channel-level stagger (CHANNEL_STAGGER_FACTOR)', () => {
  it('runs only a subset of channels per cycle, and covers every channel exactly once over one full rotation', async () => {
    const channels = manyChannels(8); // 2 full periods of the current 4-cycle rotation
    vi.mocked(dataStore.getChannels).mockResolvedValue(channels);

    // The server derives its cycle from wall-clock time (Date.now() / 30min), unlike the desktop
    // app's ever-incrementing in-memory counter — real 30-minute-apart calls would each land on a
    // different cycle automatically, but calling it back-to-back in a test would hit the SAME
    // cycle every time. Advance fake time by exactly one interval between calls so 4 calls here
    // are equivalent to 4 real, consecutive scheduled runs.
    vi.useFakeTimers();
    const perCycleTouched: Set<string>[] = [];
    try {
      for (let i = 0; i < 4; i++) {
        vi.mocked(runProviders).mockClear();
        await runAll('user1');
        perCycleTouched.push(new Set(vi.mocked(runProviders).mock.calls.map((c) => c[0].channelId)));
        vi.advanceTimersByTime(30 * 60 * 1000);
      }
    } finally {
      vi.useRealTimers();
    }

    for (const touched of perCycleTouched) {
      expect(touched.size).toBeLessThan(channels.length);
      expect(touched.size).toBeGreaterThan(0);
    }

    const union = new Set(perCycleTouched.flatMap((s) => [...s]));
    expect(union.size).toBe(channels.length);
  });

  it('a manual runChannel call is never subject to channel-level staggering', async () => {
    const channel = manyChannels(1)[0];
    vi.mocked(dataStore.getChannels).mockResolvedValue([channel]);

    vi.useFakeTimers();
    try {
      for (let i = 0; i < 4; i++) {
        vi.mocked(runProviders).mockClear();
        await runChannel('user1', channel.id);
        expect(runProviders).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(30 * 60 * 1000);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runAll — the paced provider gate is threaded through, not built per call', () => {
  it('passes the gate given to runAll straight through to every runProviders call', async () => {
    const channels = manyChannels(1);
    vi.mocked(dataStore.getChannels).mockResolvedValue(channels);
    const gate = { allow: vi.fn(() => true), spent: vi.fn() };

    await runAll('user1', gate);

    for (const call of vi.mocked(runProviders).mock.calls) {
      expect(call[1]).toBe(gate);
    }
  });

  it('a manual runChannel call with no gate runs ungated, same as before this existed', async () => {
    const channel = manyChannels(1)[0];
    vi.mocked(dataStore.getChannels).mockResolvedValue([channel]);

    await runChannel('user1', channel.id);

    for (const call of vi.mocked(runProviders).mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });
});
