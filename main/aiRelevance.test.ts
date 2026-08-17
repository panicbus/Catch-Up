import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterRelevant } from './aiRelevance';
import { channelProfile } from './providers/channelProfiles';
import type { ClassificationStoreLike } from './classificationStore';
import type { ProviderConfig } from './providers/classifier';
import type { FetchedArticle } from './providers/types';

// classifyOffTopic makes a real network call internally (callModel) — mocked at the module
// boundary so these tests exercise filterRelevant's own orchestration (which candidates it sends,
// how it reacts to the verdict, how each group falls back) without needing a real API key or
// network access. isAiConfigured is mocked too so a fake ProviderConfig below reads as "configured"
// without needing a real key/env var.
vi.mock('./providers/classifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/classifier')>();
  return { ...actual, classifyOffTopic: vi.fn(), isAiConfigured: vi.fn(() => true) };
});

import { classifyOffTopic } from './providers/classifier';

const mockedClassify = vi.mocked(classifyOffTopic);

function article(overrides: Partial<FetchedArticle> = {}): FetchedArticle {
  return {
    url: `https://example.com/${Math.random()}`,
    title: 'Untitled story',
    snippet: null,
    source: 'test-source',
    publishedAt: new Date().toISOString(),
    imageUrl: null,
    section: null,
    tags: null,
    provider: 'custom:test-source-id',
    ...overrides,
  };
}

const fakeConfig: ProviderConfig = { provider: 'gemini', apiKey: 'fake-key-for-tests' };

function fakeStore(overrides: Partial<ClassificationStoreLike> = {}): ClassificationStoreLike {
  return {
    getVerdicts: vi.fn(async () => new Map()),
    remainingDailyBudget: vi.fn(async () => 1000),
    recordClassifications: vi.fn(async () => {}),
    ...overrides,
  };
}

const sportsProfile = channelProfile('Sports');

beforeEach(() => {
  vi.mocked(classifyOffTopic).mockReset();
});

describe('filterRelevant — borderline AI rescue', () => {
  it('sends a borderline (heuristic-rejected) story to the model, and rescues it when the model says it is on-topic', async () => {
    // "Giants win 5-2" alone fails the strict "all words of a multi-word entity" rule for a
    // hypothetical "San Francisco Giants" channel — exactly the case this rescue exists for.
    const giantsProfile = channelProfile('San Francisco Giants');
    const a = article({ title: 'Giants win 5-2 behind a strong outing from the bullpen' });

    mockedClassify.mockResolvedValue(new Set()); // model: nothing here is off-topic → rescued
    const store = fakeStore();

    const result = await filterRelevant(
      [a],
      'San Francisco Giants',
      'chan-1',
      'San Francisco Giants',
      null,
      giantsProfile,
      store,
      fakeConfig,
      null
    );

    expect(result).toEqual([a]);
    expect(mockedClassify).toHaveBeenCalledTimes(1);
    const sentIds = (mockedClassify.mock.calls[0][0] as { items: { title: string }[] }).items;
    expect(sentIds.some((i) => i.title === a.title)).toBe(true);
  });

  it('does NOT rescue a borderline story the model actually flags as off-topic', async () => {
    const giantsProfile = channelProfile('San Francisco Giants');
    const a = article({ title: 'Giants win 5-2 behind a strong outing from the bullpen' });

    mockedClassify.mockImplementation(async (input) => new Set(input.items.map((i) => i.id)));
    const store = fakeStore();

    const result = await filterRelevant([a], 'x', 'chan-1', 'San Francisco Giants', null, giantsProfile, store, fakeConfig, null);
    expect(result).toEqual([]);
  });

  it('never calls the model at all when AI is not configured — strict result stands as-is', async () => {
    const giantsProfile = channelProfile('San Francisco Giants');
    const a = article({ title: 'Giants win 5-2 behind a strong outing from the bullpen' });
    const store = fakeStore();

    const result = await filterRelevant([a], 'x', 'chan-1', 'San Francisco Giants', null, giantsProfile, store, null, null);

    expect(result).toEqual([]); // strict heuristic alone rejects it, no config = no rescue attempt
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it('falls back a borderline story to REJECTED (not kept) when the model call fails, unlike a heuristic-kept story which stays kept', async () => {
    const keptByHeuristic = article({ title: "S.F. ethics commission votes to end politicians' campaign finance loophole" });
    const borderline = article({ title: 'S.F. removes peer counselors from street crisis teams amid pleas to keep them' });
    const politicsProfile = channelProfile('Politics');
    const sportsProfile2 = channelProfile('Sports');

    mockedClassify.mockResolvedValue(null); // model unavailable/failed

    // Run once per channel, same as a real refresh would (one call per channel's own gate) — the
    // point here is each story's OWN fallback (its group), not that they share one profile.
    const politicsResult = await filterRelevant([keptByHeuristic], 'Politics', 'chan-1', 'Politics', null, politicsProfile, fakeStore(), fakeConfig, null);
    const sportsResult = await filterRelevant([borderline], 'Sports', 'chan-2', 'Sports', null, sportsProfile2, fakeStore(), fakeConfig, null);

    expect(politicsResult).toEqual([keptByHeuristic]);
    expect(sportsResult).toEqual([]);
  });

  it('falls back the same way (borderline rejected) when the daily budget is exhausted, without calling the model at all', async () => {
    const borderline = article({ title: 'S.F. removes peer counselors from street crisis teams amid pleas to keep them' });
    const store = fakeStore({ remainingDailyBudget: vi.fn(async () => 0) });

    const result = await filterRelevant([borderline], 'Sports', 'chan-1', 'Sports', null, sportsProfile, store, fakeConfig, null);

    expect(result).toEqual([]);
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it('respects a cached off-topic verdict for a borderline story without re-asking the model', async () => {
    const { articleId } = await import('./providers/dedupe');
    const a = article({ title: 'Giants win 5-2 behind a strong outing from the bullpen' });
    const giantsProfile = channelProfile('San Francisco Giants');
    const cacheKey = `chan-1:${articleId(a.url)}`;
    const store = fakeStore({ getVerdicts: vi.fn(async () => new Map([[cacheKey, false]])) });

    const result = await filterRelevant([a], 'x', 'chan-1', 'San Francisco Giants', null, giantsProfile, store, fakeConfig, null);

    expect(result).toEqual([]);
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it('a confidently off-topic story (exclude-keyword hit) is never sent to the model at all — only genuine borderline cases are', async () => {
    // A category channel's exclude list is a hard, confident negative — judgeArticle returns
    // 'reject' directly for this, never 'borderline', so it should never even reach the classifier.
    const techProfile = channelProfile('Tech');
    const a = article({ title: 'Virginia Tech Hokies win the quarterback showdown', section: null });
    const store = fakeStore();
    mockedClassify.mockResolvedValue(new Set());

    const result = await filterRelevant([a], 'Tech', 'chan-1', 'Tech', null, techProfile, store, fakeConfig, null);

    expect(result).toEqual([]);
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it('threads the resolved home country name through to the classifier call when a home location is set', async () => {
    const giantsProfile = channelProfile('San Francisco Giants');
    const a = article({ title: 'Giants win 5-2 behind a strong outing from the bullpen' });
    mockedClassify.mockResolvedValue(new Set());
    const store = fakeStore();

    await filterRelevant(
      [a],
      'San Francisco Giants',
      'chan-1',
      'San Francisco Giants',
      null,
      giantsProfile,
      store,
      fakeConfig,
      { lat: 34.05223, lon: -118.24368, countryCode: 'US' }
    );

    expect(mockedClassify).toHaveBeenCalledTimes(1);
    expect(mockedClassify.mock.calls[0][0]).toMatchObject({ homeCountryName: 'the United States' });
  });

  it('passes a null home country name when no home location is set', async () => {
    const giantsProfile = channelProfile('San Francisco Giants');
    const a = article({ title: 'Giants win 5-2 behind a strong outing from the bullpen' });
    mockedClassify.mockResolvedValue(new Set());
    const store = fakeStore();

    await filterRelevant([a], 'San Francisco Giants', 'chan-1', 'San Francisco Giants', null, giantsProfile, store, fakeConfig, null);

    expect(mockedClassify.mock.calls[0][0]).toMatchObject({ homeCountryName: null });
  });
});
