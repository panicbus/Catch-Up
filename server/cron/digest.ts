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
import { localHourAndDate, isDigestDue } from './digestSchedule';

// Set by digest.yml's manual "force" workflow_dispatch input ONLY — the scheduled runs never set
// this, so the hour/dedupe checks below always apply to every real send. Lets a manual test run
// actually send right away instead of silently doing nothing until the account's real send hour
// comes around, which is what happened the first time this was tested live.
const FORCE_SEND = process.env.DIGEST_FORCE_SEND === 'true';

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

    const lastSentDate = settings.lastDigestSentDate?.toISOString().slice(0, 10) ?? null;
    if (!FORCE_SEND && !isDigestDue(hour, settings.digestSendHour, lastSentDate, date)) {
      notDue++;
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
      // A forced test send deliberately does NOT record lastDigestSentDate — it's a manual, one-off
      // action, not the real automatic send, so it shouldn't consume the account's real digest for
      // today. Skipping this write means the actual scheduled send still goes out normally later.
      if (!FORCE_SEND) {
        await prisma.settings.update({ where: { userId: user.id }, data: { lastDigestSentDate: new Date(date) } });
      }
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
