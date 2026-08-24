/** Fetches and parses ONE already-known-good feed URL — the recurring-poll half of the custom
 * sources feature. server/customSources/discover.ts is the other half (turning whatever a user
 * pastes into one of these URLs in the first place); this file never guesses at a URL, only reads
 * the one already resolved and stored on a CustomSource row.
 *
 * Deliberately not reusing main/providers/fetchWithTimeout.ts (its own doc comment scopes it to the
 * six fixed providers' URL-only signature) or server/reader/fetchPage.ts (built for one-shot HTML
 * article extraction, not conditional-GET feed polling) — this needs its own request shape
 * (Accept: XML, conditional-GET validator headers) and its own response handling (304, XML not
 * HTML). It DOES reuse server/lib/urlSafety.ts's checkUrl, since this fetch is exactly the
 * "user-typed URL, fetched on a recurring schedule" case that module's doc comment calls out by
 * name — every fetch here, not just the first one, needs that gate. */

import Parser from 'rss-parser';
import { checkUrl } from '../lib/urlSafety';
import type { ProviderArticle } from '../../main/providers/types';

const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
// A feed is plain text/XML, not a full rendered page with images — the reader's 3MB cap (tuned for
// real article HTML) would be wildly generous here. 1MB comfortably covers even a chatty 100-item
// feed; a feed regularly exceeding that is more likely broken/looping than a normal publisher.
const MAX_BYTES = 1_000_000;
// Curated single-source feed, not a broad noisy keyword search (googleNewsRss.ts caps to 10 for
// exactly that reason) — a little more headroom is reasonable, still bounded against one very
// prolific feed dominating every channel it touches.
export const MAX_ITEMS_PER_FETCH = 20;
const USER_AGENT = 'Mozilla/5.0 (compatible; CatchUpBot/0.19; +https://usecatchup.app)';

const parser = new Parser();

export interface FeedValidators {
  etag: string | null;
  lastModified: string | null;
}

export type FeedFetchResult =
  | { ok: true; notModified: false; title: string | null; articles: ProviderArticle[]; validators: FeedValidators }
  | { ok: true; notModified: true }
  // Carries the body it already downloaded (plus the post-redirect URL, for resolving relative
  // <link> hrefs) so a caller that's about to try reading this same URL as an ordinary HTML page —
  // see server/customSources/discover.ts's Tier 2 — can reuse it instead of fetching it again.
  | { ok: false; reason: 'not-a-feed'; body: string; finalUrl: string }
  | { ok: false; reason: 'blocked-host' | 'too-large' | 'http-error' | 'timeout' | 'network'; status?: number };

/** Turns one rss-parser item into a ProviderArticle, or null if it's missing the bare minimum
 * (link + title) to be worth keeping — mirrors googleNewsRss.ts's own filter, but this maps
 * snippet/image too, since an arbitrary publisher's own feed (unlike Google's aggregator one)
 * commonly includes both. Exported (not just used internally) so it's directly unit-testable
 * against a hand-built item, the same way relevance.ts exports its own small pure helpers rather
 * than only testing them indirectly through a full fetch. */
export function mapItem(item: Parser.Item): ProviderArticle | null {
  if (!item.link || !item.title) return null;
  const publishedAt =
    item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString());
  // contentSnippet is rss-parser's own HTML-stripped, whitespace-collapsed version of
  // description/content:encoded — already exactly the plain-text shape this app's cards want, no
  // separate stripping needed here.
  const snippet = item.contentSnippet?.trim() || null;
  // Not every feed uses <enclosure> for its image — some (Ghost, some WordPress themes) embed the
  // first image directly in content:encoded instead. That's a real gap, but recovering it means
  // parsing HTML per item on every poll; left for later if it turns out to matter in practice
  // (most publisher feeds do use enclosure, per typical WordPress/Ghost defaults).
  const imageUrl = item.enclosure?.url ?? null;
  // source is deliberately left blank here, not the feed's own per-item byline (which most feeds
  // don't even provide, and would be redundant with the source picker's own label anyway) — the
  // caller (server/customSources/refresh.ts) fills it in from the CustomSource row's own `label`
  // once it knows which source this batch came from. Keeps this mapper agnostic of anything beyond
  // "one feed item in, one ProviderArticle out."
  return { url: item.link, title: item.title.trim(), snippet, source: '', publishedAt, imageUrl, tags: feedCategories(item) };
}

/** The feed's own <category> labels, normalized to plain strings — rss-parser already parses these
 * and they were previously discarded outright, which was the single biggest reason a custom source's
 * stories almost never made it into any channel. Custom sources are a "loose" provider (see
 * relevance.ts's isLooseProvider), so they must clear a higher bar than a normal provider: either a
 * section match or TWO distinct category keywords in the text. Long-form investigative headlines
 * ("The Bail Machine") routinely have neither, so with the feed's own labels thrown away there was
 * effectively no path in at all. A ProPublica item tagged `Politics, Government, Congress` now clears
 * that bar on its labels alone.
 *
 * Mapped to `tags` and deliberately NOT to `section`: tags only ever ADD evidence (they feed
 * includeHitCount), whereas section additionally makes sectionIsForeign reachable — so a feed whose
 * own label happened to be "Culture" would start taking a penalty in a Politics channel. Pure
 * downside, and not something the feed's author meant to signal.
 *
 * Atom's `<category term="x"/>` parses to an object rather than a string (RSS 2.0's plain
 * `<category>x</category>` gives a string), so both shapes are normalized here rather than trusting
 * rss-parser's `string[]` typing, which only describes the RSS case. */
function feedCategories(item: Parser.Item): string[] | null {
  const raw: unknown = item.categories;
  if (!Array.isArray(raw)) return null;
  const names = raw
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') {
        const attrTerm = (c as { $?: { term?: unknown } }).$?.term;
        if (typeof attrTerm === 'string') return attrTerm;
        const text = (c as { _?: unknown })._;
        if (typeof text === 'string') return text;
      }
      return '';
    })
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 ? names : null;
}

/** Fetches and parses a known feed URL. `validators` (from the last successful fetch, if any) are
 * sent as conditional-GET headers — a 304 short-circuits straight to `{ notModified: true }` with no
 * parsing, the common case for a feed polled hourly that hasn't actually changed since. */
export async function fetchFeed(feedUrl: string, validators?: FeedValidators): Promise<FeedFetchResult> {
  let url = checkUrl(feedUrl);
  if (!url) return { ok: false, reason: 'blocked-host' };

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' };
  if (validators?.etag) headers['If-None-Match'] = validators.etag;
  if (validators?.lastModified) headers['If-Modified-Since'] = validators.lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response;
      try {
        res = await fetch(url.toString(), { signal: controller.signal, headers, redirect: 'manual' });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return { ok: false, reason: 'timeout' };
        return { ok: false, reason: 'network' };
      }

      if (res.status === 304) return { ok: true, notModified: true };

      // Manual redirect, re-validated on every hop — same reasoning as fetchPage.ts: this fetch runs
      // against a genuinely user-supplied URL on every recurring poll, so a publisher shouldn't be
      // able to redirect it into an internal address after the initial URL passed checkUrl().
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return { ok: false, reason: 'http-error' };
        const next = checkUrl(new URL(location, url).toString());
        if (!next) return { ok: false, reason: 'blocked-host' };
        url = next;
        continue;
      }

      if (!res.ok) return { ok: false, reason: 'http-error', status: res.status };

      const reader = res.body?.getReader();
      let xml: string;
      if (!reader) {
        xml = await res.text();
      } else {
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > MAX_BYTES) {
              await reader.cancel().catch(() => {});
              return { ok: false, reason: 'too-large' };
            }
            chunks.push(value);
          }
        }
        xml = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
      }

      let feed: Parser.Output<Record<string, unknown>>;
      try {
        feed = await parser.parseString(xml);
      } catch {
        return { ok: false, reason: 'not-a-feed', body: xml, finalUrl: url.toString() };
      }

      const articles = (feed.items ?? [])
        .map(mapItem)
        .filter((a): a is ProviderArticle => a !== null)
        .slice(0, MAX_ITEMS_PER_FETCH);

      return {
        ok: true,
        notModified: false,
        title: feed.title?.trim() || null,
        articles,
        validators: { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') },
      };
    }
    return { ok: false, reason: 'http-error' }; // too many redirects
  } finally {
    clearTimeout(timer);
  }
}
