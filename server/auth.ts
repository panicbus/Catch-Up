/** Resolves which account is acting. Every route goes through this single seam instead of ever
 * referencing an id directly — which is what made real sign-in a change to this one function rather
 * than to every route, exactly as the schema's own header comment anticipated.
 *
 * There is deliberately NO anonymous fallback. This used to return the single `isOwner` account for
 * every request regardless of who was asking, which was correct when one account was the only one
 * that could exist. Now that anyone can sign in, "the" owner is no longer a meaningful answer to
 * "who is asking?" — so a request without a valid session is rejected rather than silently served
 * someone else's data. Sign-in is therefore required to use the web app at all.
 *
 * The cron job (server/cron/refresh.ts) has no request and no session, so it deliberately does NOT
 * use this — it enumerates users directly. */

import type { Request } from 'express';
import { prisma } from './db';
import { SESSION_COOKIE, hashSessionToken } from './auth/session';

/** Thrown when a request has no valid session. routes.ts maps this to a real 401 (not the blanket
 * 400 everything else gets) so the frontend can tell "signed out / session expired" apart from an
 * ordinary failure by status code, rather than by matching on message text. */
export class UnauthorizedError extends Error {
  constructor(message = 'Not signed in.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export async function resolveUser(req: Request): Promise<string> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw !== 'string' || raw.length === 0) throw new UnauthorizedError();

  // The cookie holds the raw token; the table stores only its hash (see the Session model), so the
  // lookup hashes first and a stolen database row can't be replayed as a working session.
  const session = await prisma.session.findUnique({
    where: { id: hashSessionToken(raw) },
    select: { userId: true, expiresAt: true },
  });
  if (!session) throw new UnauthorizedError();
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('Your session has expired — please sign in again.');
  }
  return session.userId;
}

/** The only user fields that ever reach the browser. Everything else on the row (provider API keys
 * live on Settings, but the same instinct applies) stays server-side. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export async function getPublicUser(userId: string): Promise<PublicUser> {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, avatarUrl: true },
  });
}
