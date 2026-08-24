/** Paces each metered news provider's SHARED daily allowance evenly across the day's cron runs,
 * instead of leaving it available to whichever run gets there first.
 *
 * Why this exists: server/refreshAgent.ts's CHANNEL_STAGGER_FACTOR throttle (see its own comment)
 * fixed the acute overshoot by blunt force — running only ~1/11th of channels per cycle, regardless
 * of how much of the day's quota is actually still available. That's needlessly conservative for a
 * quiet hour (most channels paused/quiet, plenty of quota left) and still a blunt instrument for a
 * busy one. This store tracks actual provider spend GLOBALLY (across every account, since the API
 * keys are app-level, not per-user — that's ProviderDailyBudget's job, a different, per-account
 * runaway guard) and computes, once per cron run, how much of what's LEFT today a single run may
 * spend on each provider — so a quiet run leaves more for later ones automatically, and the day's
 * capacity is never front-loaded away before evening.
 *
 * Shape follows providerBudget.ts/classificationStore.ts's proven pattern: UTC-day bucketing, an
 * upsert-increment write, env-overridable constants. */

import { prisma } from '../db';
import type { ProviderGate } from '../../main/providers/registry';

// Cadence the pacing math assumes — the cron actually runs every 30 minutes (see refreshAgent.ts's
// own INTERVAL_MS/schedule), so a day holds 48 runs. Env-overridable so re-tuning the cron's
// frequency doesn't silently mis-pace this without a matching code change.
const RUNS_PER_DAY = Number(process.env.PROVIDER_PACING_RUNS_PER_DAY) || 48;
const RUN_INTERVAL_MS = (24 * 60 * 60 * 1000) / RUNS_PER_DAY;

// Daily caps for the four KEYED providers (their real published free-tier allowances). Google News
// RSS and Hacker News are deliberately absent — no API key, no shared quota to protect — so
// PacedGate.allow() below treats any provider not listed here as unmetered and always allows it.
const PROVIDER_CAPS: Record<string, number> = {
  newsdata: 200,
  gnews: 100,
  guardian: 500,
  nytimes: 500,
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** How many of the day's 30-minute-cadence runs are still left, counting this one — the divisor in
 * "spend at most (what's left) / (runs left) this run." Floors at 1 so the last run of the day gets
 * to spend the whole remaining allowance rather than dividing by zero. */
function runsRemainingToday(): number {
  const now = new Date();
  const nextMidnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextMidnightUtc - now.getTime()) / RUN_INTERVAL_MS));
}

/** In-memory for the lifetime of one runAll call — never persisted directly; see flush(). Allowances
 * are fixed at construction (computed once from today's usage-so-far), so every channel in this run
 * shares the same pool rather than each recomputing its own slice of what's left. */
class PacedGate implements ProviderGate {
  private readonly spentCount = new Map<string, number>();

  constructor(private readonly allowance: ReadonlyMap<string, number>) {}

  allow(providerId: string): boolean {
    const cap = this.allowance.get(providerId);
    if (cap === undefined) return true; // unmetered — always allowed
    return (this.spentCount.get(providerId) ?? 0) < cap;
  }

  spent(providerId: string): void {
    if (!this.allowance.has(providerId)) return; // unmetered — nothing to track
    this.spentCount.set(providerId, (this.spentCount.get(providerId) ?? 0) + 1);
  }

  snapshot(): ReadonlyMap<string, number> {
    return this.spentCount;
  }
}

/** Builds this run's gate from today's usage-so-far (one read), and returns a flush() that persists
 * whatever actually got spent through it (one write per provider touched, called once at the end of
 * runAll — not per channel, matching mergeGroups' own batching reasoning elsewhere in this codebase). */
export async function buildPacedGate(): Promise<{ gate: ProviderGate; flush: () => Promise<void> }> {
  const today = new Date(todayStr());
  const rows = await prisma.providerUsage.findMany({ where: { date: today } });
  const usedToday = new Map(rows.map((r) => [r.provider, r.count]));
  const remainingRuns = runsRemainingToday();

  const allowance = new Map<string, number>();
  for (const [provider, cap] of Object.entries(PROVIDER_CAPS)) {
    const remaining = Math.max(0, cap - (usedToday.get(provider) ?? 0));
    allowance.set(provider, Math.ceil(remaining / remainingRuns));
  }

  const pacedGate = new PacedGate(allowance);
  const flush = async (): Promise<void> => {
    const spent = [...pacedGate.snapshot().entries()].filter(([, count]) => count > 0);
    await Promise.all(
      spent.map(([provider, count]) =>
        prisma.providerUsage.upsert({
          where: { provider_date: { provider, date: today } },
          create: { provider, date: today, count },
          update: { count: { increment: count } },
        })
      )
    );
  };

  return { gate: pacedGate, flush };
}
