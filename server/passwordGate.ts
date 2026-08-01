/** A deliberately simple access gate for this phase: since there's no real sign-in yet but this is
 * a genuinely internet-reachable service, every request must present a shared password (set once,
 * known only to the owner) via a header. Not real authentication — no accounts, no sessions — just
 * a lock on the door until real accounts exist. Cheap to remove later: delete this file and its
 * one line in server/index.ts. */

import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-site-password';

export function passwordGate(req: Request, res: Response, next: NextFunction): void {
  const required = process.env.SITE_PASSWORD;
  if (!required) {
    // Fails CLOSED, not open: an unset password blocks everything rather than silently leaving
    // the site wide open if whoever deploys it forgets to set one.
    res.status(503).json({ error: 'This server has no SITE_PASSWORD configured yet.' });
    return;
  }
  if (req.header(HEADER) !== required) {
    res.status(401).json({ error: 'Incorrect site password.' });
    return;
  }
  next();
}
