/** Per-account daily ceiling on news-provider fetches.
 *
 * Why this exists: the provider API keys (NewsData, Guardian, GNews, NYTimes) are app-level and
 * SHARED by every account. Without a per-account ceiling, a few guests refreshing enthusiastically
 * would burn the day's quota for everyone — including the founder, whose app this is.
 *
 * So the owner account is exempt outright: never counted, never checked, no row ever written. That
 * short-circuit is the whole design goal ("share it freely without my own use being degraded"),
 * and it's a single early return rather than a threshold comparison specifically so it can't be
 * subtly wrong at the boundary.
 *
 * Shape is a deliberate copy of ClassificationDailyBudget/classificationStore.ts, which already
 * solved this same problem for Gemini's quota — same UTC-day bucketing, same upsert-increment, same
 * env-overridable constant. Two metered resources, one proven pattern. */

import { prisma } from '../db';

// Counted in SEARCHES — one topic fanned out across every configured provider, i.e. one
// runProviders() call in refreshAgent.ts. Not in refresh clicks (one click on a channel with
// subchannels is several searches) and not in raw HTTP calls (the fan-out width varies with how
// many provider keys are configured). Searches are the unit the refresh loop actually iterates, so
// it's the one that can be counted honestly.
//
// Sizing, from the real loop rather than a guess: a channel costs 1 search plus its subchannels
// split across STAGGER_FACTOR (3) cycles. A fairly heavy guest — 10 channels, 3 subchannels each —
// is ~20 searches per cron run, and the cron runs 48x/day, so ~960. 1500 leaves that user
// comfortably unaffected while still bounding any single account's worst case to something
// predictable. This is a runaway guard, not a rationing scheme: nobody using the app normally
// should ever meet it. Env-overridable so tuning against real usage needs no code change — the
// cron's per-run summary log is the instrument to tune against.
const GUEST_DAILY_SEARCH_CAP = Number(process.env.GUEST_DAILY_SEARCH_CAP) || 1500;

/** Same UTC-day bucketing as classificationStore.ts — the `date` column is a Postgres DATE, so the
 * budget resets at midnight UTC, which is what resetsAt below reports. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Next midnight UTC — when a capped account's budget frees up again. Sent to the browser so it can
 * show "resets in 4h 12m" without needing the server's clock. */
export function nextResetAt(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Thrown when a guest account has spent its day's fetches. Carries the reset time so the API can
 * pass it to the browser rather than making the user guess when they can refresh again. */
export class RateLimitedError extends Error {
  readonly resetsAt: Date;
  constructor(resetsAt: Date) {
    super('Daily refresh limit reached.');
    this.name = 'RateLimitedError';
    this.resetsAt = resetsAt;
  }
}

async function isOwner(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isOwner: true } });
  return user?.isOwner === true;
}

/** How many searches this account has left today. `Infinity` for the owner — not merely a large
 * number, so no caller can accidentally treat the owner as "generously capped" rather than exempt. */
export async function remainingSearchBudget(userId: string): Promise<number> {
  if (await isOwner(userId)) return Infinity;
  const row = await prisma.providerDailyBudget.findUnique({
    where: { userId_date: { userId, date: new Date(todayStr()) } },
    select: { count: true },
  });
  return Math.max(0, GUEST_DAILY_SEARCH_CAP - (row?.count ?? 0));
}

/** Throws RateLimitedError if this account has nothing left today. Call before doing provider work,
 * not after — the point is to avoid spending quota, not to report having spent it. */
export async function assertSearchBudget(userId: string): Promise<void> {
  if ((await remainingSearchBudget(userId)) <= 0) throw new RateLimitedError(nextResetAt());
}

/** Records searches actually performed. No-op for the owner, so no budget row is ever created for
 * that account at all — a test asserts exactly that, since "capped at a very high number" and
 * "genuinely exempt" look identical right up until someone raises the number. */
export async function recordSearches(userId: string, count: number): Promise<void> {
  if (count <= 0) return;
  if (await isOwner(userId)) return;
  const today = new Date(todayStr());
  await prisma.providerDailyBudget.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, count },
    update: { count: { increment: count } },
  });
}
