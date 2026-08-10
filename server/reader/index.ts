/** Orchestrates the reader-view pipeline: load the article row, run the ok/skip gates, then try
 * content tiers in order until one succeeds. The only file in server/reader/ that touches Prisma —
 * everything else here is pure Node (fetch/URL/linkedom/readability), matching the
 * Electron-agnostic contract main/providers/types.ts states for its own folder, so this could move
 * under main/reader/ later for desktop parity without a rewrite, if that's ever wanted.
 *
 * Extraction failures are NOT thrown — see routes.ts's call site. A site being hard to scrape is an
 * expected, routine outcome, not an application error; only genuine auth/rate-limit conditions
 * throw (handled upstream by the existing UnauthorizedError/RateLimitedError machinery). */

import * as articlesCache from '../stores/articlesCache';
import { isReaderBlockedDomain } from './blockedDomains';
import { tryGuardianBody } from './guardianBody';
import { fetchPage } from './fetchPage';
import { extractReadable } from './extract';
import type { ReaderBlock, ReaderResponse } from '../../ipc-contract';

// One extraction in flight at a time, per process — the real memory-safety mechanism on Render's
// 512MB free tier. Two concurrent Readability parses of a ~1.5MB page is the realistic OOM
// scenario; serializing them costs a personal app's users a second of latency and removes the
// failure mode outright. A short queue absorbs "two tabs open at once"; beyond that, fail fast
// rather than let a queue of waiters build up behind a slow publisher.
const MAX_CONCURRENT = 1;
const MAX_QUEUED = 2;
let active = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<boolean> {
  if (active < MAX_CONCURRENT) {
    active++;
    return true;
  }
  if (waiters.length >= MAX_QUEUED) return false;
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
  return true;
}

function releaseSlot(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

/** Readability (and, less often, the Guardian API's own `body` HTML) commonly repeats the
 * article's featured/thumbnail image as literally the first element of the content it returns —
 * the same image already shown separately as the hero above the title (leadImageUrl, sourced from
 * the article row's own thumbnail). Left alone that reads as two copies of the same photo stacked
 * on top of each other — confirmed live, reported after this feature first shipped. Only trims when
 * a hero is actually about to render; with no thumbnail at all, a genuine first body image is the
 * only image available and stays. */
function stripLeadingDuplicateImage(blocks: ReaderBlock[], leadImageUrl: string | null): ReaderBlock[] {
  if (!leadImageUrl) return blocks;
  return blocks[0]?.type === 'img' ? blocks.slice(1) : blocks;
}

export async function getReaderContent(userId: string, channelId: string, articleId: string): Promise<ReaderResponse> {
  const row = await articlesCache.getArticleById(userId, channelId, articleId);
  if (!row) return { ok: false, reason: 'failed' };

  // Gate A — never attempt a paywalled source. Legal/ethical line, and free: the flag already
  // exists (main/providers/paywallDomains.ts) and is already shown to the user via PaywallBadge.
  if (row.paywalled) return { ok: false, reason: 'paywalled' };
  // Gate B — sites confirmed live not to work with a plain server-side fetch (401/403/refused).
  if (isReaderBlockedDomain(row.sourceDomain)) return { ok: false, reason: 'blocked' };
  // Gate C — Google News RSS `link` values are opaque news.google.com redirect tokens that need a
  // browser to resolve; these cards also carry no snippet/image today (googleNewsRss.ts stores both
  // as null), so there's nothing to lose by skipping straight to "can't preview this link".
  if (row.provider === 'googlenewsrss') return { ok: false, reason: 'unsupported' };

  const gotSlot = await acquireSlot();
  if (!gotSlot) return { ok: false, reason: 'busy' };
  try {
    // Tier 1: The Guardian's licensed Content API — first-party full text, zero scraping. Tries
    // unconditionally; tryGuardianBody itself no-ops for any non-theguardian.com URL.
    const guardian = await tryGuardianBody(row.url);
    if (guardian) {
      return {
        ok: true,
        articleId: row.id,
        url: row.url,
        title: row.title,
        source: row.source,
        sourceDomain: row.sourceDomain,
        byline: guardian.byline,
        publishedAt: row.publishedAt.toISOString(),
        leadImageUrl: row.imageUrl,
        wordCount: guardian.wordCount,
        blocks: stripLeadingDuplicateImage(guardian.blocks, row.imageUrl),
        tier: 'guardian',
        truncated: guardian.truncated,
        partial: false,
      };
    }

    // Tier 2: fetch the real page and run it through Readability.
    const fetched = await fetchPage(row.url);
    if (!fetched.ok) {
      // Granular cause (blocked-host/too-large/not-html/http-error/timeout/network) — logged here,
      // not in fetchPage.ts itself, so every failure for a given article is one line next to its
      // URL. The client only ever sees the flattened 'failed' reason (see ReaderUnavailable's
      // taxonomy) — this is purely for reading Render's logs to see which cause actually dominates
      // in production, which can differ from local testing (e.g. a publisher's bot-detection
      // treating Render's datacenter IP differently than a residential one).
      console.warn('[reader] fetchPage failed', { url: row.url, reason: fetched.reason, status: fetched.status });
      return { ok: false, reason: 'failed' };
    }

    const extracted = extractReadable(fetched.html, fetched.finalUrl);
    if (!extracted.ok) {
      console.warn('[reader] extraction too short', { url: row.url, finalUrl: fetched.finalUrl });
      return { ok: false, reason: extracted.reason };
    }

    return {
      ok: true,
      articleId: row.id,
      url: row.url,
      title: extracted.title || row.title,
      source: row.source,
      sourceDomain: row.sourceDomain,
      byline: extracted.byline,
      publishedAt: row.publishedAt.toISOString(),
      leadImageUrl: row.imageUrl,
      wordCount: extracted.wordCount,
      blocks: stripLeadingDuplicateImage(extracted.blocks, row.imageUrl),
      tier: 'readability',
      truncated: extracted.truncated,
      partial: extracted.partial,
    };
  } finally {
    releaseSlot();
  }
}
