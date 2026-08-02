/** A deliberately simple access gate for this phase: since there's no real sign-in yet but this is
 * a genuinely internet-reachable service, every request must present a shared password (set once,
 * known only to the owner) via a header. Not real authentication — no accounts, no sessions — just
 * a lock on the door until real accounts exist. Cheap to remove later: delete this file and its
 * lines in server/index.ts.
 *
 * A shared password is only as strong as its weakest guardrail, so two of them live here:
 *   - constant-time comparison, so response timing can't leak the password character by character
 *   - a failure-only rate limit (see failedAuthLimiter), because an unlimited-guess endpoint makes
 *     any human-memorable password brute-forceable at network speed. This is the single most
 *     important control in this file — without it the password's length is nearly irrelevant. */

import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-site-password';

/** Timing-safe equality for two strings of any length. Hashing first gives both sides a fixed
 * width, so timingSafeEqual can't throw on a length mismatch (and length itself isn't leaked). */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Counts only REJECTED requests (skipSuccessfulRequests), so ordinary use — including the app's
 * background polling — never trips it, while guessing runs out of attempts almost immediately. */
export const failedAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many incorrect password attempts. Try again later.' },
});

export function passwordGate(req: Request, res: Response, next: NextFunction): void {
  const required = process.env.SITE_PASSWORD;
  if (!required) {
    // Fails CLOSED, not open: an unset password blocks everything rather than silently leaving
    // the site wide open if whoever deploys it forgets to set one.
    res.status(503).json({ error: 'This server has no SITE_PASSWORD configured yet.' });
    return;
  }
  const provided = req.header(HEADER);
  if (!provided || !safeEqual(provided, required)) {
    res.status(401).json({ error: 'Incorrect site password.' });
    return;
  }
  next();
}
