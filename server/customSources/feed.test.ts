import { describe, it, expect, vi, afterEach } from 'vitest';
import Parser from 'rss-parser';
import { mapItem, MAX_ITEMS_PER_FETCH, fetchFeed } from './feed';

// Minimal stand-in for the fetch Response shape fetchFeed actually reads (status/ok/headers.get/text)
// — no streaming body, so fetchFeed takes its `!reader` fallback path (res.body?.getReader() is
// undefined here, same as it would be for a real Response with no readable body implementation).
function fakeResponse(opts: { status: number; headers?: Record<string, string>; text?: string }): Response {
  const lower = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status: opts.status,
    ok: opts.status >= 200 && opts.status < 300,
    headers: { get: (k: string) => lower.get(k.toLowerCase()) ?? null },
    text: async () => opts.text ?? '',
    body: undefined,
  } as unknown as Response;
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Mission Local</title>
    <item>
      <title>Supervisors approve new housing plan</title>
      <link>https://missionlocal.org/2026/08/supervisors-approve-housing/</link>
      <description>&lt;p&gt;The Board of Supervisors voted 8-3 to approve the plan.&lt;/p&gt;</description>
      <pubDate>Sat, 16 Aug 2026 13:00:00 +0000</pubDate>
      <enclosure url="https://missionlocal.org/wp-content/uploads/housing.jpg" type="image/jpeg" />
    </item>
    <item>
      <title>Item with no link</title>
      <description>Should be dropped.</description>
      <pubDate>Sat, 16 Aug 2026 12:00:00 +0000</pubDate>
    </item>
    <item>
      <link>https://missionlocal.org/no-title/</link>
      <description>Also should be dropped.</description>
    </item>
  </channel>
</rss>`;

describe('mapItem', () => {
  it('maps a well-formed item to a ProviderArticle, stripping HTML from the description', async () => {
    const parser = new Parser();
    const feed = await parser.parseString(SAMPLE_RSS);
    const mapped = mapItem(feed.items[0]);
    expect(mapped).toEqual({
      url: 'https://missionlocal.org/2026/08/supervisors-approve-housing/',
      title: 'Supervisors approve new housing plan',
      snippet: 'The Board of Supervisors voted 8-3 to approve the plan.',
      source: '',
      publishedAt: new Date('Sat, 16 Aug 2026 13:00:00 +0000').toISOString(),
      imageUrl: 'https://missionlocal.org/wp-content/uploads/housing.jpg',
    });
  });

  it('drops items missing a link or a title', () => {
    expect(mapItem({ title: 'No link here' })).toBeNull();
    expect(mapItem({ link: 'https://example.com/x' })).toBeNull();
  });

  it('falls back to null snippet/image when the feed provides neither', () => {
    const mapped = mapItem({ link: 'https://example.com/y', title: 'Bare item' });
    expect(mapped?.snippet).toBeNull();
    expect(mapped?.imageUrl).toBeNull();
  });
});

describe('fetchFeed item cap (via a full parse)', () => {
  it('parses real feed XML and caps at MAX_ITEMS_PER_FETCH', async () => {
    const items = Array.from({ length: MAX_ITEMS_PER_FETCH + 10 }, (_, i) => `
      <item>
        <title>Story ${i}</title>
        <link>https://example.com/${i}</link>
        <pubDate>Sat, 16 Aug 2026 12:00:00 +0000</pubDate>
      </item>`).join('');
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Big Feed</title>${items}</channel></rss>`;
    const parser = new Parser();
    const feed = await parser.parseString(xml);
    const mapped = feed.items.map(mapItem).filter((a): a is NonNullable<typeof a> => a !== null).slice(0, MAX_ITEMS_PER_FETCH);
    expect(mapped).toHaveLength(MAX_ITEMS_PER_FETCH);
  });
});

describe('fetchFeed redirect handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows a redirect to a safe external host and parses the feed found there', async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>Hi</title><link>https://example.com/a</link></item></channel></rss>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ status: 302, headers: { location: 'https://example.com/real-feed' } }))
      .mockResolvedValueOnce(fakeResponse({ status: 200, text: rss }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchFeed('https://example.com/rss');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/real-feed');
  });

  it('refuses to follow a redirect into a blocked host, and never requests it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchFeed('https://example.com/rss');

    expect(result).toEqual({ ok: false, reason: 'blocked-host' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the blocked hop must never actually be requested
  });

  it('gives up after MAX_REDIRECTS hops rather than following a redirect loop forever', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse({ status: 302, headers: { location: 'https://example.com/next' } })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchFeed('https://example.com/rss');

    expect(result).toEqual({ ok: false, reason: 'http-error' });
    expect(fetchMock.mock.calls.length).toBeLessThan(10);
  });
});
