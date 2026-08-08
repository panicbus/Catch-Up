/** Session tokens and the cookie that carries them.
 *
 * The token in the cookie is raw random bytes; the `sessions` table stores only its sha256 hash.
 * That asymmetry is the point — read access to the database (a backup, a stray log line, a support
 * query) yields hashes that can't be replayed, while verifying an incoming cookie is still a single
 * indexed lookup. Same instinct the old shared-password gate had when it compared hashes rather
 * than raw strings. */

import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../db';

export const SESSION_COOKIE = 'cu_session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** Mints a session row and returns the RAW token — the only moment it exists outside the browser.
 * It is never stored, logged, or returned in a response body; it goes straight into the cookie. */
export async function createSession(
  userId: string,
  req: Request
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      id: hashSessionToken(token),
      userId,
      expiresAt,
      // Recorded for future "your active sessions" visibility; nothing reads these yet.
      userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
      ipAddress: req.ip ?? null,
    },
  });
  return { token, expiresAt };
}

/** Signing out deletes the row, so the session is dead immediately everywhere — the thing a
 * stateless token can't do without extra machinery. Missing rows are fine (already signed out). */
export async function deleteSession(rawToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashSessionToken(rawToken) } });
}

/** Cookie attributes here are load-bearing.
 *
 * `sameSite: 'lax'` works because the site (usecatchup.app) and the API (api.usecatchup.app) are
 * now subdomains of the same registrable domain — a "same-site" pair, even though they're different
 * origins. That's specifically what fixed sign-in inside the iOS home-screen app: standalone/
 * installed web apps on iOS apply much stricter cookie rules to genuinely CROSS-site requests
 * (confirmed live — sign-in worked in a normal Safari tab but silently failed to persist from the
 * home-screen icon), and 'lax' only ever needs to survive a same-site request, so it clears that bar
 * even in the more locked-down standalone context.
 *
 * This was 'none' when the site (Vercel) and the API (Render) were on two unrelated domains
 * (`*.vercel.app` / `*.onrender.com`) — that combination is genuinely cross-site, and 'lax' would
 * have silently dropped the cookie on every API call. Both still work as plain HTTPS addresses
 * (Render's own subdomain stays enabled alongside the custom domain), but signing in through THAT
 * old pairing no longer persists now that this is 'lax' — accepted, since real use has already moved
 * to the custom domain.
 *
 * `secure` (HTTPS-only) and `httpOnly` (unreadable from JavaScript, the main reason this is a
 * cookie rather than a token in localStorage) are unrelated to any of the above and stay on
 * regardless. */
function cookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export function clearSessionCookie(res: Response): void {
  // Must match the attributes it was set with, or the browser treats it as a different cookie and
  // leaves the original in place.
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
