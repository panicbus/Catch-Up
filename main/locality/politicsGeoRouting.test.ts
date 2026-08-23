import { describe, it, expect } from 'vitest';
import { routeByCountry } from './politicsGeoRouting';
import type { FetchedArticle } from '../providers/types';

function article(overrides: Partial<FetchedArticle> = {}): FetchedArticle {
  return {
    url: 'https://example.com/story',
    title: 'Untitled story',
    snippet: null,
    source: 'test-source',
    publishedAt: new Date().toISOString(),
    imageUrl: null,
    provider: 'guardian',
    ...overrides,
  };
}

const US = 'US';

describe('routeByCountry', () => {
  it('keeps a home-country story in main', () => {
    const a = article({ title: 'Senate advances new budget bill' });
    const routed = routeByCountry([a], US, []);
    expect(routed.main).toEqual([a]);
    expect(routed.toSubchannel.size).toBe(0);
  });

  it('keeps a no-place story in main', () => {
    const a = article({ title: 'Committee chairman rejects allegations against him' });
    const routed = routeByCountry([a], US, []);
    expect(routed.main).toEqual([a]);
  });

  it('routes a foreign-country story to the matching subchannel, not main', () => {
    const a = article({ title: 'India announces new election reform policy' });
    const routed = routeByCountry([a], US, [{ id: 'sub-india', name: 'India' }]);
    expect(routed.main).toEqual([]);
    expect(routed.toSubchannel.get('sub-india')).toEqual([a]);
  });

  it('routes a region-only mention (no country named) to the matching country subchannel', () => {
    const a = article({ title: 'Osun 2026: Parade of Paradox and Parody of Politics' });
    const routed = routeByCountry([a], US, [{ id: 'sub-nigeria', name: 'Nigeria' }]);
    expect(routed.main).toEqual([]);
    expect(routed.toSubchannel.get('sub-nigeria')).toEqual([a]);
  });

  it('drops a foreign-country story with no matching subchannel — the actual hard exclude', () => {
    const a = article({ title: 'India announces new election reform policy' });
    const routed = routeByCountry([a], US, [{ id: 'sub-elections', name: 'Elections' }]);
    expect(routed.main).toEqual([]);
    expect(routed.toSubchannel.size).toBe(0);
  });

  it('a bare continent mention (no specific country) stays in main, same as before this feature', () => {
    const a = article({ title: 'Political unrest spreads across Africa' });
    const routed = routeByCountry([a], US, []);
    expect(routed.main).toEqual([a]);
  });

  it('routes several articles across several countries and subchannels correctly in one pass', () => {
    const home = article({ title: 'Senate advances new budget bill' });
    const india = article({ url: 'https://example.com/india', title: 'India announces new election reform policy' });
    const nigeria = article({ url: 'https://example.com/nigeria', title: 'Protests continue in Lagos over fuel prices' });
    const dropped = article({ url: 'https://example.com/dropped', title: 'France announces new labor reform policy' });

    const routed = routeByCountry(
      [home, india, nigeria, dropped],
      US,
      [
        { id: 'sub-india', name: 'India' },
        { id: 'sub-nigeria', name: 'Nigeria' },
      ]
    );

    expect(routed.main).toEqual([home]);
    expect(routed.toSubchannel.get('sub-india')).toEqual([india]);
    expect(routed.toSubchannel.get('sub-nigeria')).toEqual([nigeria]);
    expect(routed.toSubchannel.size).toBe(2);
  });

  it('the first subchannel to name a given country claims it, when two subchannels somehow name the same one', () => {
    const a = article({ title: 'India announces new election reform policy' });
    const routed = routeByCountry(
      [a],
      US,
      [
        { id: 'sub-first', name: 'India' },
        { id: 'sub-second', name: 'India' },
      ]
    );
    expect(routed.toSubchannel.get('sub-first')).toEqual([a]);
    expect(routed.toSubchannel.has('sub-second')).toBe(false);
  });

  it('returns an empty result for an empty input list', () => {
    const routed = routeByCountry([], US, [{ id: 'sub-india', name: 'India' }]);
    expect(routed.main).toEqual([]);
    expect(routed.toSubchannel.size).toBe(0);
  });
});
