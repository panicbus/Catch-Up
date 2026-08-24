import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderQuery } from './types';

// Every provider module is mocked out to a controllable stand-in — runProviders' own job is
// FAN-OUT (which providers run, in what order, gated by what) not any individual provider's own
// fetch logic, which each already has its own colocated test. isConfigured/fetchArticles are
// vi.fn()s so each test can flip them per provider.
vi.mock('./newsdata', () => ({ newsDataProvider: { id: 'newsdata', isConfigured: vi.fn(() => true), fetchArticles: vi.fn(async () => []) } }));
vi.mock('./guardian', () => ({ guardianProvider: { id: 'guardian', isConfigured: vi.fn(() => true), fetchArticles: vi.fn(async () => []) } }));
vi.mock('./gnews', () => ({ gNewsProvider: { id: 'gnews', isConfigured: vi.fn(() => true), fetchArticles: vi.fn(async () => []) } }));
vi.mock('./googleNewsRss', () => ({ googleNewsRssProvider: { id: 'googlenewsrss', isConfigured: vi.fn(() => true), fetchArticles: vi.fn(async () => []) } }));
vi.mock('./hackerNews', () => ({ hackerNewsProvider: { id: 'hackernews', isConfigured: vi.fn(() => true), fetchArticles: vi.fn(async () => []) } }));
vi.mock('./nytimes', () => ({ nytimesProvider: { id: 'nytimes', isConfigured: vi.fn(() => true), fetchArticles: vi.fn(async () => []) } }));
vi.mock('./cooldown', () => ({ isCoolingDown: vi.fn(() => false) }));

import { runProviders } from './registry';
import { newsDataProvider } from './newsdata';
import { guardianProvider } from './guardian';
import { gNewsProvider } from './gnews';
import { googleNewsRssProvider } from './googleNewsRss';
import { hackerNewsProvider } from './hackerNews';
import { nytimesProvider } from './nytimes';
import { isCoolingDown } from './cooldown';

const QUERY: ProviderQuery = { topic: 'Politics', channelId: 'c1', subchannelId: null };

const primaries = [newsDataProvider, guardianProvider, gNewsProvider, hackerNewsProvider, nytimesProvider];
const all = [...primaries, googleNewsRssProvider];

beforeEach(() => {
  for (const p of all) {
    vi.mocked(p.isConfigured).mockReset().mockReturnValue(true);
    vi.mocked(p.fetchArticles).mockReset().mockResolvedValue([]);
  }
  vi.mocked(isCoolingDown).mockReset().mockReturnValue(false);
  // Below MIN_ARTICLES_BEFORE_FALLBACK (5) by default, so most tests exercise the fallback path too
  // unless a test deliberately makes a primary return enough articles to skip it.
});

describe('runProviders — gate wiring (see providerUsage.ts for the only real ProviderGate)', () => {
  it('with no gate at all, every configured provider runs — desktop behavior, unchanged', async () => {
    await runProviders(QUERY);
    for (const p of all) expect(p.fetchArticles).toHaveBeenCalledTimes(1);
  });

  it('a provider the gate refuses is never queried at all, and never charged via spent()', async () => {
    const gate = { allow: vi.fn((id: string) => id !== 'newsdata'), spent: vi.fn() };

    await runProviders(QUERY, gate);

    expect(newsDataProvider.fetchArticles).not.toHaveBeenCalled();
    expect(guardianProvider.fetchArticles).toHaveBeenCalledTimes(1);
    expect(gate.spent).not.toHaveBeenCalledWith('newsdata');
    expect(gate.spent).toHaveBeenCalledWith('guardian');
  });

  it('spent() is called once for every provider actually queried, allowed or not', async () => {
    const gate = { allow: vi.fn(() => true), spent: vi.fn() };
    await runProviders(QUERY, gate);
    for (const p of primaries) expect(gate.spent).toHaveBeenCalledWith(p.id);
  });

  it('a provider skipped for having no configured key is neither asked nor charged — a gate has no opinion on that', async () => {
    vi.mocked(newsDataProvider.isConfigured).mockReturnValue(false);
    const gate = { allow: vi.fn(() => true), spent: vi.fn() };

    await runProviders(QUERY, gate);

    expect(newsDataProvider.fetchArticles).not.toHaveBeenCalled();
    expect(gate.allow).not.toHaveBeenCalledWith('newsdata');
    expect(gate.spent).not.toHaveBeenCalledWith('newsdata');
  });

  it('a provider mid-cooldown is neither asked nor charged, same as an unconfigured one', async () => {
    // Regression: a cooling-down provider's own fetchArticles already short-circuits to [] with no
    // real request made (see cooldown.ts) — gate.spent() must not fire for it either, or a paced
    // gate would record real spend for a request that never happened, artificially exhausting that
    // provider's allowance for the rest of the day even after the real rate limit has recovered.
    vi.mocked(isCoolingDown).mockImplementation((id: string) => id === 'newsdata');
    const gate = { allow: vi.fn(() => true), spent: vi.fn() };

    await runProviders(QUERY, gate);

    expect(newsDataProvider.fetchArticles).not.toHaveBeenCalled();
    expect(gate.spent).not.toHaveBeenCalledWith('newsdata');
    expect(gate.spent).toHaveBeenCalledWith('guardian');
  });

  it('the fallback provider is skipped by the gate exactly like a primary — no special case', async () => {
    const gate = { allow: vi.fn((id: string) => id !== 'googlenewsrss'), spent: vi.fn() };

    await runProviders(QUERY, gate); // primaries return [] (< 5), so fallback would otherwise fire

    expect(googleNewsRssProvider.fetchArticles).not.toHaveBeenCalled();
  });

  it('the fallback is never even asked (gate or no gate) once a primary run already met the threshold', async () => {
    vi.mocked(newsDataProvider.fetchArticles).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ url: `https://x/${i}`, title: `t${i}`, snippet: null, source: 's', publishedAt: new Date().toISOString(), imageUrl: null }))
    );
    const gate = { allow: vi.fn(() => true), spent: vi.fn() };

    await runProviders(QUERY, gate);

    expect(googleNewsRssProvider.fetchArticles).not.toHaveBeenCalled();
    expect(gate.spent).not.toHaveBeenCalledWith('googlenewsrss');
  });
});
