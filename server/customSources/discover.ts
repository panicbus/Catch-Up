/** Turns whatever URL a user pastes into a real, working feed URL — the add-time (and retry-time)
 * half of the custom sources feature. Only runs when a source is added or manually retried, never
 * on the recurring poll (server/customSources/refresh.ts uses feed.ts directly against the already-
 * resolved feedUrl a CustomSource row stores), so the extra network round trips below are a
 * one-time cost, not a per-poll one.
 *
 * Three tiers, cheapest/most-likely first:
 *   1. Maybe the pasted URL already IS a feed (missionlocal.org/feed/ — common when a user finds
 *      the feed link themselves).
 *   2. Maybe the pasted page's own HTML links to its feed (<link rel="alternate">) — the standard
 *      way a site is supposed to advertise this, though many don't bother.
 *   3. Maybe the feed lives at one of a handful of conventional paths on the same site
 *      (jambase.com/articles has no link tag, but jambase.com/rss is real and works — confirmed
 *      live, not assumed).
 * If none of those pan out, this reports that plainly rather than attempting to scrape the page's
 * HTML for article links directly — that's a fundamentally different, much less reliable problem
 * (and some sites, jambase.com/articles included, need a real browser to even render their article
 * list, which this app deliberately doesn't run). */

import { parseHTML } from 'linkedom';
import { checkUrl } from '../lib/urlSafety';
import { fetchPage } from '../reader/fetchPage';
import { fetchFeed, type FeedFetchResult, type FeedValidators } from './feed';
import type { ProviderArticle } from '../../main/providers/types';

const CONVENTIONAL_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml', '/index.xml'];

export type DiscoverResult =
  | { ok: true; feedUrl: string; title: string | null; articles: ProviderArticle[]; validators: FeedValidators }
  | { ok: false; reason: 'invalid-url' | 'not-found' | 'unreachable' | 'empty' };

/** A user pasting a bare domain ("propublica.org") or "www.propublica.org" with no scheme is the
 * common case, not the exception — confirmed as the single biggest reason adding a source felt
 * hard: `new URL()` throws on schemeless input, which checkUrl (below) then reports as
 * 'invalid-url' before a fetch is even attempted, even though the only thing actually wrong with
 * it is the missing "https://". Prepending it when no scheme is present puts that input on the
 * exact same path a fully-typed "https://propublica.org" already takes. Left alone whenever a
 * scheme IS present (including a deliberately-typed "http://") — this only fills in something
 * genuinely missing, never overrides an explicit choice. Exported for direct unit testing. */
export function normalizeSourceUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** A successful, non-empty FeedFetchResult, narrowed for the tiers below — every tier's "did this
 * candidate URL actually work" check is the same shape. Carries the validators through (not just
 * the articles) so the caller can seed a newly-added source's etag/lastModified from THIS fetch —
 * the one that just proved the feed works — instead of leaving them null until the next scheduled
 * poll happens to succeed. */
function asSuccess(feedUrl: string, result: FeedFetchResult): DiscoverResult | null {
  if (!result.ok || result.notModified) return null;
  if (result.articles.length === 0) return null;
  return { ok: true, feedUrl, title: result.title, articles: result.articles, validators: result.validators };
}

/** Resolves an origin-relative or absolute alternate-feed href from a page's own HTML head.
 * Exported for direct unit testing against a hand-built HTML fixture, no network needed. */
export function findFeedLinkInHtml(html: string, baseUrl: string): string | null {
  const { document } = parseHTML(html);
  const link = document.querySelector(
    'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]'
  );
  const href = link?.getAttribute('href');
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export async function discoverFeed(rawUrl: string): Promise<DiscoverResult> {
  const parsed = checkUrl(normalizeSourceUrl(rawUrl));
  if (!parsed) return { ok: false, reason: 'invalid-url' };

  // Tracks whether ANY attempt across any tier got a real answer from the host at all (even a 404,
  // even a malformed-XML response) — distinguishes "this site has no feed we could find" (not-found)
  // from "this site never responded to begin with" (unreachable), which get different, more honest
  // messages shown to the user.
  let reachable = false;
  const noteReachable = (result: { reason?: string }) => {
    if (result.reason !== 'network' && result.reason !== 'timeout') reachable = true;
  };

  // Tier 1: maybe it's already a feed.
  const direct = await fetchFeed(parsed.toString());
  if (direct.ok) {
    reachable = true;
    const success = asSuccess(parsed.toString(), direct);
    if (success) return success;
    if (!direct.notModified) return { ok: false, reason: 'empty' }; // parsed fine, zero items
  } else if (direct.reason === 'blocked-host') {
    return { ok: false, reason: 'invalid-url' }; // same host would block every other tier too
  } else {
    noteReachable(direct);
  }

  // Tier 2: does the page's own HTML advertise its feed? If Tier 1 already downloaded this exact
  // URL and found it wasn't valid feed XML, reuse that body instead of fetching the identical URL
  // again — the common case in practice is a user pasting a homepage, which fails Tier 1 as
  // 'not-a-feed' and lands here needing its HTML anyway.
  let page: { html: string; finalUrl: string } | null = null;
  if (!direct.ok && direct.reason === 'not-a-feed') {
    reachable = true;
    page = { html: direct.body, finalUrl: direct.finalUrl };
  } else {
    const fetched = await fetchPage(parsed.toString());
    if (fetched.ok) {
      reachable = true;
      page = { html: fetched.html, finalUrl: fetched.finalUrl };
    } else {
      noteReachable(fetched);
    }
  }
  if (page) {
    const linkedFeedUrl = findFeedLinkInHtml(page.html, page.finalUrl);
    if (linkedFeedUrl) {
      const viaLink = await fetchFeed(linkedFeedUrl);
      if (viaLink.ok) reachable = true;
      const success = asSuccess(linkedFeedUrl, viaLink);
      if (success) return success;
    }
  }

  // Tier 3: try a handful of conventional feed paths on the same origin, in parallel — this is
  // exactly how jambase.com/rss gets found even though /articles has no link tag at all.
  const origin = parsed.origin;
  const candidates = CONVENTIONAL_PATHS.map((p) => origin + p);
  const attempts = await Promise.allSettled(candidates.map((c) => fetchFeed(c)));
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    if (attempt.status !== 'fulfilled') continue;
    if (attempt.value.ok) reachable = true;
    else noteReachable(attempt.value);
    const success = asSuccess(candidates[i], attempt.value);
    if (success) return success;
  }

  return { ok: false, reason: reachable ? 'not-found' : 'unreachable' };
}
