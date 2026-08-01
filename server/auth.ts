/** Resolves which account is acting — every route (and the cron job, which has no request at all)
 * goes through this single seam instead of ever referencing an id directly. For now it always
 * returns the one owner account (seeded by the migration script), but every store call downstream
 * already takes a real userId, so plugging in real sign-in later only means changing what happens
 * inside this one function. `_req` is unused today but kept so a future version backed by a real
 * session/token has somewhere to read it from without changing every call site. */

import type { Request } from 'express';
import { prisma } from './db';

let cachedOwnerId: string | null = null;

export async function resolveUser(_req?: Request): Promise<string> {
  if (cachedOwnerId) return cachedOwnerId;
  const owner = await prisma.user.findFirst({ where: { isOwner: true } });
  if (!owner) {
    throw new Error(
      'No owner account exists yet — run the migration script to seed one before using the API.'
    );
  }
  cachedOwnerId = owner.id;
  return owner.id;
}
