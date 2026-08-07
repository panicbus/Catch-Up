/** Real-database tests for the session primitives (resolveUser, createSession/deleteSession) and
 * the sign-in upsert-by-email logic that POST /auth/google (server/routes.ts) uses. There's no HTTP
 * harness in this suite, so the upsert test exercises the identical Prisma operation rather than
 * calling the route — real founder data is on the line if that logic is wrong, which is why it gets
 * its own explicit test rather than "coverage in general."
 *
 * Run with `npm run test:db` (needs DATABASE_URL). Follows accountIsolation.db.test.ts's established
 * conventions: unique throwaway emails, beforeAll/afterAll cleanup, real Prisma calls, no mocking. */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Request } from 'express';
import { prisma } from '../db';
import { resolveUser, UnauthorizedError } from '../auth';
import { createSession, deleteSession, hashSessionToken, SESSION_COOKIE } from './session';

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL = `session-${SUFFIX}@example.test`;
const OWNER_EMAIL = `session-owner-${SUFFIX}@example.test`;

let userId = '';
let ownerId = '';

// resolveUser only reads req.cookies[SESSION_COOKIE]; createSession additionally reads req.get()
// and req.ip for the optional userAgent/ipAddress columns (see session.ts) — this fake covers
// exactly those, rather than standing up a real Express request.
function fakeReq(cookieValue?: string): Request {
  return {
    cookies: cookieValue !== undefined ? { [SESSION_COOKIE]: cookieValue } : {},
    get: () => undefined,
    ip: undefined,
  } as unknown as Request;
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: EMAIL } });
  userId = user.id;

  // A real isOwner:true account with real data attached — the thing the sign-in upsert must never
  // duplicate or silently demote.
  const owner = await prisma.user.create({ data: { email: OWNER_EMAIL, isOwner: true, displayName: 'Founder' } });
  ownerId = owner.id;
  await prisma.settings.create({ data: { userId: ownerId } });
  await prisma.streak.create({ data: { userId: ownerId } });
  await prisma.channel.create({
    data: { userId: ownerId, name: 'Existing Channel', slug: 'existing-channel', sortOrder: 0 },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, OWNER_EMAIL] } } });
  await prisma.$disconnect();
});

describe('sessions', () => {
  it('a created session resolves back to the same user via the real hash lookup', async () => {
    const { token } = await createSession(userId, fakeReq());
    expect(await resolveUser(fakeReq(token))).toBe(userId);
  });

  it('an expired session is rejected, not silently accepted', async () => {
    const { token } = await createSession(userId, fakeReq());
    // Backdate it directly — createSession always mints a real 30-day expiry, so this is the only
    // way to produce a genuinely expired row without waiting 30 days.
    await prisma.session.update({
      where: { id: hashSessionToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(resolveUser(fakeReq(token))).rejects.toThrow(UnauthorizedError);
  });

  it('a missing or unrecognized cookie is rejected', async () => {
    await expect(resolveUser(fakeReq())).rejects.toThrow(UnauthorizedError);
    await expect(resolveUser(fakeReq('not-a-real-token'))).rejects.toThrow(UnauthorizedError);
  });

  it('logout deletes the row — the session stops resolving immediately, not just eventually expiring', async () => {
    const { token } = await createSession(userId, fakeReq());
    expect(await resolveUser(fakeReq(token))).toBe(userId);
    await deleteSession(token);
    await expect(resolveUser(fakeReq(token))).rejects.toThrow(UnauthorizedError);
  });
});

describe('the sign-in upsert (mirrors POST /auth/google in server/routes.ts)', () => {
  it('signing in with the owner’s email attaches to the EXISTING row and leaves isOwner untouched', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(before.googleId).toBeNull();

    // Identical shape to the route's own upsert — isOwner is deliberately absent from `update`.
    const updated = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {
        googleId: 'google-sub-owner',
        authProvider: 'google',
        avatarUrl: 'https://example.test/pic.jpg',
        displayName: 'Founder',
      },
      create: { email: OWNER_EMAIL, googleId: 'google-sub-owner', authProvider: 'google', displayName: 'Founder' },
    });

    expect(updated.id).toBe(ownerId); // same row — not a new account
    expect(updated.googleId).toBe('google-sub-owner');
    expect(updated.authProvider).toBe('google');
    expect(updated.isOwner).toBe(true); // survived the upsert — a demoted owner would start getting capped

    const channels = await prisma.channel.findMany({ where: { userId: ownerId } });
    expect(channels.map((c) => c.name)).toEqual(['Existing Channel']); // pre-existing data intact

    const total = await prisma.user.count({ where: { email: OWNER_EMAIL } });
    expect(total).toBe(1); // no duplicate account was created
  });
});
