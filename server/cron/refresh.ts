/** Entrypoint for the scheduled news-refresh job (a Render Cron Job — see the deployment plan's
 * "Background refresh job" section). Unlike the desktop app's always-running 30-minute timer, this
 * runs once, refreshes every one of the owner's channels, logs a summary, and exits — no window or
 * tray icon keeping anything alive, because there's nothing that needs keeping alive: the schedule
 * itself is what triggers the next run. */

import 'dotenv/config';
import { prisma } from '../db';
import { resolveUser } from '../auth';
import { runAll } from '../refreshAgent';

(async () => {
  const startedAt = Date.now();
  const userId = await resolveUser();
  const results = await runAll(userId);

  const totalAdded = results.reduce((sum, r) => sum + r.added, 0);
  const totalErrors = results.flatMap((r) => r.errors);
  console.log(
    `[cron] refreshed ${results.length} channel(s), ${totalAdded} new story/stories, ` +
      `${totalErrors.length} error(s), ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );
  if (totalErrors.length > 0) console.warn('[cron] errors:', totalErrors);

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('[cron] refresh job failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
