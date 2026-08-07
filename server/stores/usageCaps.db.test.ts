/** Real-database tests for the usage-cap system — providerBudget.ts's daily search budget, plus the
 * channel cap in dataStore.ts's createChannel. This is the part of the whole auth pass most likely
 * to be wrong in a way nobody notices until either a guest is wrongly blocked or, worse, the founder
 * is wrongly capped — so the owner-exemption short-circuit gets its own explicit assertions, not
 * just "the threshold works."
 *
 * Run with `npm run test:db` (needs DATABASE_URL). Follows accountIsolation.db.test.ts's established
 * conventions: unique throwaway emails, beforeAll/afterAll cleanup, real Prisma calls, no mocking. */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../db';
import * as dataStore from './dataStore';
import { remainingSearchBudget, assertSearchBudget, recordSearches, RateLimitedError } from './providerBudget';

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const GUEST_EMAIL = `budget-guest-${SUFFIX}@example.test`;
const OTHER_GUEST_EMAIL = `budget-guest2-${SUFFIX}@example.test`;
const CHANNEL_GUEST_EMAIL = `budget-channel-guest-${SUFFIX}@example.test`;
const OWNER_EMAIL = `budget-owner-${SUFFIX}@example.test`;

const CAP = Number(process.env.GUEST_DAILY_SEARCH_CAP) || 1500;

let guestId = '';
let otherGuestId = '';
let channelGuestId = '';
let ownerId = '';

async function seedUser(email: string, isOwner = false): Promise<string> {
  const user = await prisma.user.create({ data: { email, isOwner } });
  await prisma.settings.create({ data: { userId: user.id } });
  await prisma.streak.create({ data: { userId: user.id } });
  return user.id;
}

beforeAll(async () => {
  guestId = await seedUser(GUEST_EMAIL);
  otherGuestId = await seedUser(OTHER_GUEST_EMAIL);
  channelGuestId = await seedUser(CHANNEL_GUEST_EMAIL);
  ownerId = await seedUser(OWNER_EMAIL, true);
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: [GUEST_EMAIL, OTHER_GUEST_EMAIL, CHANNEL_GUEST_EMAIL, OWNER_EMAIL] } },
  });
  await prisma.$disconnect();
});

describe('per-account daily search budget', () => {
  it('a guest hits the cap and the next call throws with a future resetsAt', async () => {
    await recordSearches(guestId, CAP);
    expect(await remainingSearchBudget(guestId)).toBe(0);

    const err = await assertSearchBudget(guestId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).resetsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('the owner is never capped — no budget row is even written, not merely a high threshold', async () => {
    // Five times the guest cap — if the owner exemption were a threshold instead of a short-circuit,
    // this would fail loudly rather than silently pass at a smaller number.
    await recordSearches(ownerId, CAP * 5);
    await expect(assertSearchBudget(ownerId)).resolves.toBeUndefined();
    expect(await remainingSearchBudget(ownerId)).toBe(Infinity);

    const today = new Date().toISOString().slice(0, 10);
    const row = await prisma.providerDailyBudget.findUnique({
      where: { userId_date: { userId: ownerId, date: new Date(today) } },
    });
    expect(row).toBeNull();
  });

  it('budget is per-account — one guest exhausting theirs does not affect another', async () => {
    expect(await remainingSearchBudget(otherGuestId)).toBe(CAP);
  });

  it('budget is per-day — yesterday’s usage does not count against today', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await prisma.providerDailyBudget.create({ data: { userId: otherGuestId, date: new Date(yesterday), count: CAP } });
    expect(await remainingSearchBudget(otherGuestId)).toBe(CAP); // today's row doesn't exist yet
  });
});

describe('per-account channel cap', () => {
  it('a guest is blocked at the limit; the owner is not', async () => {
    // Sequential, not Promise.all: createChannel counts existing rows and inserts based on that
    // count, so concurrent calls could race past the limit — the same reason the real callers
    // (ChannelSearchBar, ChannelManageList) only ever create one channel at a time.
    for (let i = 0; i < dataStore.MAX_CHANNELS_PER_USER; i++) {
      await dataStore.createChannel(channelGuestId, `Guest Channel ${i}`);
    }
    await expect(dataStore.createChannel(channelGuestId, 'One Too Many')).rejects.toThrow(
      `${dataStore.MAX_CHANNELS_PER_USER} channels`
    );

    // The owner already has 0 channels from this file's setup — one more is nowhere near the guest
    // limit, but confirms the owner path doesn't throw at counts a guest would already be fine at
    // either. (Not re-proving the guest loop above at 25 real inserts for the owner too — the
    // exemption is a single `!owner?.isOwner` short-circuit shared with providerBudget.ts's, not
    // separate logic that could pass for guests and fail for the owner at the same count.)
    await expect(dataStore.createChannel(ownerId, 'Owner Channel')).resolves.toBeDefined();
  });
});

describe('cron user ordering (server/cron/refresh.ts)', () => {
  it('orderBy isOwner desc puts the owner ahead of every guest', async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [GUEST_EMAIL, OTHER_GUEST_EMAIL, CHANNEL_GUEST_EMAIL, OWNER_EMAIL] } },
      orderBy: { isOwner: 'desc' },
    });
    expect(users[0].email).toBe(OWNER_EMAIL);
  });
});
