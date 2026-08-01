/** The one shared database connection for the hosted server — every store implementation under
 * server/stores/* imports this instead of constructing its own PrismaClient. Prisma 7 requires an
 * explicit driver adapter (no more implicit DATABASE_URL pickup), so that wiring lives here, once. */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — the server cannot connect to its database without it.');
}

const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });
