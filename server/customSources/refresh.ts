/** Orchestrates a user's custom sources: fetch, update each row's own health state regardless of
 * outcome, sort whatever came back into the right channels (and subchannels), and merge. The one
 * file in server/customSources/ that touches Prisma — everything else in this folder (feed.ts,
 * discover.ts, sort.ts) is pure, matching the same pure-core/impure-shell split server/reader/
 * already uses.
 *
 * Two entry points, both exported:
 *   - runCustomSources(userId) — the scheduled path (server/refreshAgent.ts's runAll, once per user
 *     per round), respects each source's own ~hourly throttle.
 *   - refreshOneCustomSourceNow(userId, sourceId) — the on-demand path (the retry route), bypasses
 *     the throttle for that one source, since the whole point of a user tapping Retry is "check this
 *     now," not "wait out however much of the hour is left." */

import { prisma } from '../db';
import { fetchFeed, type FeedFetchResult } from './feed';
import { sortCustomArticles } from './sort';
import * as dataStore from '../stores/dataStore';
import * as articlesCache from '../stores/articlesCache';
import type { FetchedArticle } from '../../main/providers/types';
import type { ProviderArticle } from '../../main/providers/types';

// A little under an hour, not a full 60 minutes — this job runs alongside the 30-minute provider
// refresh (see refreshAgent.ts), so a strict 60-minute gate could drift a source's actual check
// interval to 90 minutes depending on where in the cycle it lands. 55 keeps it reliably close to
// "about hourly" regardless of that alignment.
const THROTTLE_MS = 55 * 60 * 1000;
// Five consecutive real failures (not "zero items," not "notModified" — see recordOutcome) before a
// source pauses itself. Persisted on the row itself, not in-memory, since server/cron/refresh.ts's
// process exits and restarts every run — an in-memory counter wouldn't survive to the next one.
const DISABLE_AFTER_FAILURES = 5;
export const CUSTOM_PROVIDER_PREFIX = 'custom:';

interface SourceRow {
  id: string;
  feedUrl: string;
  label: string;
  etag: string | null;
  lastModified: string | null;
  consecutiveFailures: number;
  lastFetchedAt: Date | null;
}

const SOURCE_SELECT = {
  id: true,
  feedUrl: true,
  label: true,
  etag: true,
  lastModified: true,
  consecutiveFailures: true,
  lastFetchedAt: true,
} as const;

function tagArticles(articles: ProviderArticle[], source: SourceRow): FetchedArticle[] {
  return articles.map((a) => ({ ...a, source: source.label, provider: `${CUSTOM_PROVIDER_PREFIX}${source.id}` }));
}

/** Writes one source's fetch outcome back to its row — success, "nothing changed," or failure —
 * and returns any newly-tagged articles. Never throws; every outcome is reflected in the row
 * itself, which is what the UI's per-source status (and the disable-after-N-failures behavior)
 * reads. Shared by both entry points, so a source's health state means the same thing regardless of
 * which path last touched it. */
async function recordOutcome(source: SourceRow, result: FeedFetchResult): Promise<FetchedArticle[]> {
  if (result.ok && !result.notModified) {
    await prisma.customSource.update({
      where: { id: source.id },
      data: {
        lastFetchedAt: new Date(),
        consecutiveFailures: 0,
        lastError: null,
        etag: result.validators.etag,
        lastModified: result.validators.lastModified,
      },
    });
    return tagArticles(result.articles, source);
  }

  if (result.ok && result.notModified) {
    // A 304 IS a successful check — the source is healthy, it just has nothing new. Resets the
    // failure count same as a real success, but leaves etag/lastModified alone (no new values were
    // returned to replace them with).
    await prisma.customSource.update({
      where: { id: source.id },
      data: { lastFetchedAt: new Date(), consecutiveFailures: 0, lastError: null },
    });
    return [];
  }

  // Genuine failure — network/timeout/blocked/malformed. Count it, and disable after enough of them
  // in a row that this isn't just one bad poll.
  const nextCount = source.consecutiveFailures + 1;
  await prisma.customSource.update({
    where: { id: source.id },
    data: {
      lastFetchedAt: new Date(),
      consecutiveFailures: nextCount,
      lastError: result.reason,
      disabledAt: nextCount >= DISABLE_AFTER_FAILURES ? new Date() : null,
    },
  });
  return [];
}

/** Sorts a batch of already-fetched, already-tagged custom articles into the user's channels and
 * merges. Shared by both entry points AND the add-source route (which already has fresh articles
 * straight from discoverFeed's own validation fetch — no reason to fetch a brand-new source a
 * second time just to do the same sort-and-merge this function already does). */
export async function mergeCustomArticles(userId: string, articles: FetchedArticle[]): Promise<number> {
  if (articles.length === 0) return 0;
  const [allChannels, settings] = await Promise.all([dataStore.getChannels(userId), dataStore.getSettings(userId)]);
  // Same pause filter runAll() applies to the regular provider loop — a paused channel shouldn't
  // gain new stories from any source, custom ones included.
  const channels = allChannels.filter((c) => !c.pausedUntil || new Date(c.pausedUntil).getTime() <= Date.now());
  if (channels.length === 0) return 0;

  const placements = sortCustomArticles(articles, channels, settings.homeLocation);
  let added = 0;
  for (const placement of placements) {
    added += await articlesCache.merge(userId, placement.channelId, placement.subchannelId, placement.articles);
  }
  return added;
}

/** Runs one scheduled round for a user: fetches whichever active sources are actually due
 * (per-source, not per-channel — see the file comment), sorts the results into channels/
 * subchannels, and merges. Returns the same "genuinely new to read" count articlesCache.merge()
 * already reports, summed across every channel a story landed in. */
export async function runCustomSources(userId: string): Promise<number> {
  const sources = await prisma.customSource.findMany({ where: { userId, disabledAt: null }, select: SOURCE_SELECT });
  if (sources.length === 0) return 0;

  const now = Date.now();
  const due = sources.filter((s) => !s.lastFetchedAt || now - s.lastFetchedAt.getTime() >= THROTTLE_MS);
  if (due.length === 0) return 0;

  const results = await Promise.allSettled(
    due.map(async (s) => recordOutcome(s, await fetchFeed(s.feedUrl, { etag: s.etag, lastModified: s.lastModified })))
  );
  const articles: FetchedArticle[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') articles.push(...r.value);
    // A rejection here would mean the fetch/update itself threw (a bug, not an expected failure
    // path — fetchFeed/prisma errors are already handled inside recordOutcome) — logged, not
    // silently dropped, but one source's unexpected throw shouldn't take down the rest of the round.
    else console.warn('[customSources] unexpected error fetching a source', r.reason);
  }

  return mergeCustomArticles(userId, articles);
}

/** On-demand, single-source refresh — bypasses the throttle entirely (unlike runCustomSources,
 * which is what "one tap = check it now" on the retry route actually needs), still writes the same
 * outcome state and goes through the same sort-and-merge. Returns null if the source doesn't exist
 * or doesn't belong to this user, so the route can 404 rather than silently no-op. */
export async function refreshOneCustomSourceNow(userId: string, sourceId: string): Promise<number | null> {
  const source = await prisma.customSource.findFirst({ where: { id: sourceId, userId }, select: SOURCE_SELECT });
  if (!source) return null;
  const result = await fetchFeed(source.feedUrl, { etag: source.etag, lastModified: source.lastModified });
  const articles = await recordOutcome(source, result);
  return mergeCustomArticles(userId, articles);
}
