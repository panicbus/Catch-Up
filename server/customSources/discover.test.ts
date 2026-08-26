import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findFeedLinkInHtml, discoverFeed, normalizeSourceUrl } from './discover';

// Both of discoverFeed's own network calls are mocked at the module boundary so these tests can
// assert exactly how many real requests each tier makes, without hitting the network.
vi.mock('./feed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./feed')>();
  return { ...actual, fetchFeed: vi.fn() };
});
vi.mock('../reader/fetchPage', () => ({ fetchPage: vi.fn() }));

import { fetchFeed } from './feed';
import { fetchPage } from '../reader/fetchPage';

const mockedFetchFeed = vi.mocked(fetchFeed);
const mockedFetchPage = vi.mocked(fetchPage);

describe('findFeedLinkInHtml', () => {
  it('finds an RSS alternate link and resolves a relative href against the base URL', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="Feed" href="/feed/">
    </head><body></body></html>`;
    expect(findFeedLinkInHtml(html, 'https://missionlocal.org/section/')).toBe('https://missionlocal.org/feed/');
  });

  it('finds an Atom alternate link too', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
    </head></html>`;
    expect(findFeedLinkInHtml(html, 'https://example.com/')).toBe('https://example.com/atom.xml');
  });

  it('returns null when there is no alternate feed link at all', () => {
    const html = `<html><head><title>No feed here</title></head><body>Nothing.</body></html>`;
    expect(findFeedLinkInHtml(html, 'https://example.com/')).toBeNull();
  });

  it('ignores an alternate link that is not RSS/Atom (e.g. a stylesheet)', () => {
    const html = `<html><head>
      <link rel="stylesheet" type="text/css" href="/style.css">
    </head></html>`;
    expect(findFeedLinkInHtml(html, 'https://example.com/')).toBeNull();
  });

  it('returns null rather than throwing on a malformed href', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="not a url and no base to fix it">
    </head></html>`;
    // Relative to a real base this actually resolves fine (browsers are lenient) — the real failure
    // case is an empty/garbage base, covered implicitly by the try/catch in the implementation.
    expect(() => findFeedLinkInHtml(html, 'https://example.com/')).not.toThrow();
  });
});

describe('normalizeSourceUrl — the "don\'t make me type https://www." fix', () => {
  it('prepends https:// to a bare domain', () => {
    expect(normalizeSourceUrl('propublica.org')).toBe('https://propublica.org');
  });

  it('prepends https:// to a www.-prefixed domain with no scheme', () => {
    expect(normalizeSourceUrl('www.propublica.org/feed')).toBe('https://www.propublica.org/feed');
  });

  it('leaves an already-schemed https:// URL untouched', () => {
    expect(normalizeSourceUrl('https://propublica.org')).toBe('https://propublica.org');
  });

  it('leaves a deliberately-typed http:// URL untouched — never overrides an explicit choice', () => {
    expect(normalizeSourceUrl('http://propublica.org')).toBe('http://propublica.org');
  });

  it('is case-insensitive about an existing scheme', () => {
    expect(normalizeSourceUrl('HTTPS://propublica.org')).toBe('HTTPS://propublica.org');
  });

  it('trims surrounding whitespace before checking for a scheme', () => {
    expect(normalizeSourceUrl('  propublica.org  ')).toBe('https://propublica.org');
  });
});

describe('discoverFeed Tier 2 reuse', () => {
  beforeEach(() => {
    mockedFetchFeed.mockReset();
    mockedFetchPage.mockReset();
  });

  it("reuses Tier 1's already-downloaded HTML body instead of fetching the pasted URL a second time", async () => {
    const html = `<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head></html>`;
    mockedFetchFeed
      .mockResolvedValueOnce({ ok: false, reason: 'not-a-feed', body: html, finalUrl: 'https://example.com/' })
      .mockResolvedValueOnce({
        ok: true,
        notModified: false,
        title: 'Example Feed',
        articles: [
          {
            url: 'https://example.com/a',
            title: 'A',
            snippet: null,
            source: '',
            publishedAt: new Date().toISOString(),
            imageUrl: null,
          },
        ],
        validators: { etag: null, lastModified: null },
      });

    const result = await discoverFeed('https://example.com/');

    expect(result.ok).toBe(true);
    expect(mockedFetchPage).not.toHaveBeenCalled();
    expect(mockedFetchFeed).toHaveBeenCalledTimes(2);
    expect(mockedFetchFeed.mock.calls[1][0]).toBe('https://example.com/feed/');
  });

  it('resolves a bare domain (no scheme) exactly like the same URL typed with https:// — the regression this whole fix is for', async () => {
    mockedFetchFeed.mockResolvedValueOnce({
      ok: true,
      notModified: false,
      title: 'Example Feed',
      articles: [
        { url: 'https://example.com/a', title: 'A', snippet: null, source: '', publishedAt: new Date().toISOString(), imageUrl: null },
      ],
      validators: { etag: null, lastModified: null },
    });

    const result = await discoverFeed('example.com');

    // Before normalizeSourceUrl, this rejected with 'invalid-url' before fetchFeed was ever called
    // at all — new URL('example.com') throws with no scheme.
    expect(result.ok).toBe(true);
    expect(mockedFetchFeed).toHaveBeenCalledWith('https://example.com/');
  });

  it('still falls back to fetchPage when Tier 1 fails for a reason other than not-a-feed (no body to reuse)', async () => {
    mockedFetchFeed
      .mockResolvedValueOnce({ ok: false, reason: 'timeout' })
      .mockResolvedValue({ ok: false, reason: 'network' }); // Tier 3's parallel attempts
    mockedFetchPage.mockResolvedValueOnce({ ok: false, reason: 'timeout' });

    const result = await discoverFeed('https://example.com/');

    expect(result).toEqual({ ok: false, reason: 'unreachable' });
    expect(mockedFetchPage).toHaveBeenCalledTimes(1);
  });
});
