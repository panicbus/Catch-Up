/** Entrypoint for the scheduled digest-email job — modeled directly on refresh.ts's shape (a
 * standalone script run by GitHub Actions against DATABASE_URL, independent of whether the Render
 * server is awake). Runs hourly; each run finds whichever accounts' chosen local send-hour matches
 * right now and haven't already been sent today, builds their digest, and sends it.
 *
 * Enumerates users directly rather than through resolveUser() (server/auth.ts), same reasoning as
 * refresh.ts: there's no HTTP request here, and the where-clause below already scopes this to the
 * small subset of accounts with digestEnabled at all — never a full-table pull. Ordered by isOwner
 * descending, same as refresh.ts: not because of any budget concern here (there's no cap to protect
 * a digest send against), but so the owner's own digest is never the one left unsent if something
 * mid-run goes wrong (a Resend outage, an unexpected error) and the job has to bail partway through. */

import 'dotenv/config';
import { prisma } from '../db';
import * as dataStore from '../stores/dataStore';
import { buildAiConfig } from '../refreshAgent';
import { buildDigestContent } from '../digest/build';
import { digestSubject, renderDigestEmail } from '../digest/render';
import { sendDigestEmail } from '../digest/email';

/** The account's current hour-of-day (0-23) and calendar date (YYYY-MM-DD) in ITS OWN timezone —
 * not the server's. `en-CA` formats as YYYY-MM-DD directly, exactly the shape lastDigestSentDate
 * needs to be compared against. Throws on an invalid IANA zone name — callers treat that as "skip
 * this account," not a job-ending error. */
function localHourAndDate(timezone: string): { hour: number; date: string } {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  return { hour, date };
}

(async () => {
  const startedAt = Date.now();
  const users = await prisma.user.findMany({
    where: { settings: { digestEnabled: true, digestTimezone: { not: null } } },
    orderBy: { isOwner: 'desc' },
    select: {
      id: true,
      email: true,
      isOwner: true,
      settings: {
        select: {
          digestSendHour: true,
          digestTimezone: true,
          digestChannelIds: true,
          digestEmailOverride: true,
          lastDigestSentDate: true,
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let notDue = 0;

  for (const user of users) {
    const settings = user.settings;
    if (!settings?.digestTimezone) continue; // the where-clause already guarantees this; keeps TS honest

    let hour: number;
    let date: string;
    try {
      ({ hour, date } = localHourAndDate(settings.digestTimezone));
    } catch {
      console.error(`[digest] ${user.email}: invalid timezone "${settings.digestTimezone}", skipping`);
      failed++;
      continue;
    }

    if (hour !== settings.digestSendHour) {
      notDue++;
      continue;
    }
    const lastSentDate = settings.lastDigestSentDate?.toISOString().slice(0, 10) ?? null;
    if (lastSentDate === date) {
      notDue++; // already sent today, this account's own local day
      continue;
    }
    if (settings.digestChannelIds.length === 0) {
      skipped++;
      continue;
    }

    const ai = await dataStore.getAiSettings(user.id);
    const aiConfig = buildAiConfig(ai.provider, ai.geminiApiKey, ai.groqApiKey);
    const content = await buildDigestContent(user.id, settings.digestChannelIds, aiConfig);
    if (!content) {
      // Nothing unread across every selected channel — not an error, and deliberately does NOT
      // record lastDigestSentDate: the send-hour won't recur until tomorrow regardless, so leaving
      // it unset just means a real digest can still go out tomorrow if new stories land by then.
      skipped++;
      continue;
    }

    const to = settings.digestEmailOverride ?? user.email;
    const ok = await sendDigestEmail(to, digestSubject(content), renderDigestEmail(content));
    if (ok) {
      await prisma.settings.update({ where: { userId: user.id }, data: { lastDigestSentDate: new Date(date) } });
      sent++;
    } else {
      failed++;
    }
  }

  console.log(
    `[digest] ${users.length} enabled account(s), ${sent} sent, ${skipped} skipped (nothing to send), ` +
      `${notDue} not due this hour, ${failed} failed, ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('[digest] job failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
