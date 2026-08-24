/** Entrypoint for the scheduled news-refresh job (a Render Cron Job — see the deployment plan's
 * "Background refresh job" section). Unlike the desktop app's always-running 30-minute timer, this
 * runs once, refreshes every account's channels, logs a summary, and exits — no window or tray icon
 * keeping anything alive, because there's nothing that needs keeping alive: the schedule itself is
 * what triggers the next run.
 *
 * Enumerates users directly rather than going through resolveUser() (server/auth.ts) — that
 * function now requires a real request with a session cookie, and this job has neither. It's also
 * why this can't just loop "every user" in arbitrary order: the news-provider API keys are shared
 * across every account, so if the day's quota runs out mid-run, it must run out on GUESTS, never on
 * the founder. Ordering by isOwner descending puts the owner's channels through first, every run,
 * unconditionally — that ordering, not the per-guest budget check below, is what actually protects
 * the founder's own use of the app from guests sharing it. */

import 'dotenv/config';
import { prisma } from '../db';
import { runAll, type RunResult } from '../refreshAgent';
import { remainingSearchBudget } from '../stores/providerBudget';
import { buildPacedGate } from '../stores/providerUsage';
import type { ProviderGate } from '../../main/providers/registry';

interface UserSummary {
  email: string;
  isOwner: boolean;
  channels: number;
  added: number;
  errors: number;
  skipped: boolean;
}

(async () => {
  const startedAt = Date.now();
  const users = await prisma.user.findMany({
    orderBy: { isOwner: 'desc' },
    select: { id: true, email: true, isOwner: true },
  });

  const summaries: UserSummary[] = [];
  let totalAdded = 0;
  let totalErrors = 0;
  let skippedForBudget = 0;

  // Built ONCE for this whole job, not per user: the allowance it computes ("spend at most this much
  // of what's left today, on each provider, THIS run") is a global, cross-account pool — every user's
  // runAll call below shares the same gate instance, so their combined spend this run is what's
  // actually bounded, not each account's individually. See providerUsage.ts's own comment for why.
  //
  // Guarded: this is one new query sitting upstream of every account's refresh. Before this feature
  // existed, nothing here could fail this early and take the whole job down with it — a transient
  // failure reading today's usage must not abort every account's refresh (including the owner's,
  // which is exactly backwards; see this file's own top comment on why the owner must never be the
  // one who goes without). Falling back to no gate at all just means this one run goes out ungated,
  // same as every run before this feature existed.
  let gate: ProviderGate | undefined;
  let flush: (() => Promise<void>) | undefined;
  try {
    ({ gate, flush } = await buildPacedGate());
  } catch (e) {
    console.error('[cron] failed to build the paced provider gate, running this cycle ungated:', e);
  }

  try {
    for (const user of users) {
      // The owner is never checked (remainingSearchBudget returns Infinity for it) — this skip only
      // ever applies to guests, and only once their day's budget is already spent, so it's a cheap
      // no-op for everyone else.
      const remaining = await remainingSearchBudget(user.id);
      if (remaining <= 0) {
        skippedForBudget++;
        summaries.push({ email: user.email, isOwner: user.isOwner, channels: 0, added: 0, errors: 0, skipped: true });
        continue;
      }

      const results: RunResult[] = await runAll(user.id, gate);
      const added = results.reduce((sum, r) => sum + r.added, 0);
      const errors = results.flatMap((r) => r.errors).length;
      totalAdded += added;
      totalErrors += errors;
      summaries.push({ email: user.email, isOwner: user.isOwner, channels: results.length, added, errors, skipped: false });
    }
  } finally {
    // In `finally`, not after the loop: if a bug partway through the loop throws (anything other
    // than the RateLimitedError runAll already catches internally), every gate.spent() increment
    // recorded in memory so far this run must still be persisted — losing it would make the NEXT
    // run think today's usage is lower than it really is, letting cumulative spend creep past the
    // real provider caps over repeated partial failures. Its own try/catch: a failure to WRITE the
    // usage total is a soft failure (the refresh itself already succeeded), not a reason to report
    // this whole run as failed via the top-level catch's process.exit(1) below.
    if (flush) {
      try {
        await flush();
      } catch (e) {
        console.error('[cron] failed to persist provider usage for this run:', e);
      }
    }
  }

  console.log(
    `[cron] ${users.length} account(s), ${totalAdded} new story/stories, ${totalErrors} error(s), ` +
      `${skippedForBudget} guest(s) skipped (daily budget spent), ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );
  // Per-account detail is the only visibility into whether the guest cap is set sensibly — see
  // providerBudget.ts's own comment on GUEST_DAILY_SEARCH_CAP.
  for (const s of summaries) {
    const label = s.isOwner ? `${s.email} (owner)` : s.email;
    console.log(
      s.skipped
        ? `[cron]   ${label}: skipped, daily budget already spent`
        : `[cron]   ${label}: ${s.channels} channel(s), ${s.added} added, ${s.errors} error(s)`
    );
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('[cron] refresh job failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
