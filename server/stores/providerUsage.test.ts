import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks the database layer, not the real one — importing server/db.ts directly throws at import
// time without a live DATABASE_URL (same reason providerBudget.ts's own tests avoid it — see
// server/refreshAgent.test.ts's comment on the same issue).
const findMany = vi.fn();
const upsert = vi.fn();
vi.mock('../db', () => ({
  prisma: { providerUsage: { findMany: (...args: unknown[]) => findMany(...args), upsert: (...args: unknown[]) => upsert(...args) } },
}));

import { buildPacedGate } from './providerUsage';

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
  upsert.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buildPacedGate — allowance math', () => {
  it('splits what is left of each cap evenly across the runs still left today', async () => {
    // Fixed at exactly midnight UTC: 24h until the next midnight, at the 30-minute cadence this is
    // built around, is exactly 48 runs remaining (including this one) — the full RUNS_PER_DAY.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
    findMany.mockResolvedValue([
      { provider: 'newsdata', date: new Date('2026-08-23'), count: 104 },
      { provider: 'gnews', date: new Date('2026-08-23'), count: 0 },
    ]);

    const { gate } = await buildPacedGate();

    // newsdata: cap 200 - 104 used = 96 left, / 48 runs = exactly 2 per run.
    expect(gate.allow('newsdata')).toBe(true);
    gate.spent('newsdata');
    gate.spent('newsdata');
    expect(gate.allow('newsdata')).toBe(false); // spent its 2-per-run allowance

    // gnews: cap 100 - 0 used = 100 left, / 48 runs = ceil(2.08) = 3 per run.
    gate.spent('gnews');
    gate.spent('gnews');
    expect(gate.allow('gnews')).toBe(true); // only 2 of its 3 spent
    gate.spent('gnews');
    expect(gate.allow('gnews')).toBe(false);
  });

  it('floors runs-remaining at 1, so the very last run of the day gets the whole remainder rather than dividing by zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T23:59:59.999Z')); // 1ms before midnight
    findMany.mockResolvedValue([{ provider: 'newsdata', date: new Date('2026-08-23'), count: 150 }]);

    const { gate } = await buildPacedGate();

    // cap 200 - 150 used = 50 left, / 1 remaining run = all 50, not a divide-by-zero throw.
    for (let i = 0; i < 50; i++) expect(gate.allow('newsdata')).toBe(true), gate.spent('newsdata');
    expect(gate.allow('newsdata')).toBe(false);
  });

  it('a provider with no shared allowance at all (no key, no quota — e.g. the RSS fallback) is always allowed and never tracked', async () => {
    const { gate } = await buildPacedGate();
    for (let i = 0; i < 1000; i++) gate.spent('googlenewsrss');
    expect(gate.allow('googlenewsrss')).toBe(true);
  });

  it('a provider with no usage row yet gets its full cap as this run\'s starting allowance', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
    findMany.mockResolvedValue([]); // nothing spent by anyone yet today

    const { gate } = await buildPacedGate();
    // guardian: cap 500 / 48 runs = ceil(10.42) = 11.
    for (let i = 0; i < 11; i++) expect(gate.allow('guardian')).toBe(true), gate.spent('guardian');
    expect(gate.allow('guardian')).toBe(false);
  });
});

describe('buildPacedGate — flush persists only what was actually spent', () => {
  it('writes one upsert per provider actually spent through the gate, and none for untouched providers', async () => {
    findMany.mockResolvedValue([]);
    const { gate, flush } = await buildPacedGate();

    gate.spent('newsdata');
    gate.spent('newsdata');
    gate.spent('guardian');
    gate.spent('googlenewsrss'); // unmetered — never tracked, must not appear in the flush at all

    await flush();

    expect(upsert).toHaveBeenCalledTimes(2);
    const calls = upsert.mock.calls.map((c) => c[0] as { where: { provider_date: { provider: string } }; create: { count: number } });
    const newsdataCall = calls.find((c) => c.where.provider_date.provider === 'newsdata');
    const guardianCall = calls.find((c) => c.where.provider_date.provider === 'guardian');
    expect(newsdataCall?.create.count).toBe(2);
    expect(guardianCall?.create.count).toBe(1);
  });

  it('writes nothing at all when nothing was spent this run', async () => {
    findMany.mockResolvedValue([]);
    const { flush } = await buildPacedGate();
    await flush();
    expect(upsert).not.toHaveBeenCalled();
  });
});
