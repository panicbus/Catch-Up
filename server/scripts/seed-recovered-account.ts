/** One-off recovery seed for the 2026-08-05 outage.
 *
 * Neon paused the project on its monthly free-plan data-transfer limit (5.76GB of 5GB, burned in
 * four days — see the commit that added prune()'s column selection for why). A paused project can't
 * be read from, so the account's real rows could not be exported before moving hosts.
 *
 * This recreates what was recoverable from screenshots taken during that session's UI testing:
 * every channel name, Tech's three subchannel names, and the streak. Everything else is either
 * regenerated automatically (articles refill on the first refresh) or genuinely lost (the other
 * subchannel names, a handful of bookmarks, read history) — those are listed below so it's clear
 * what this does NOT restore.
 *
 * Safe to re-run: every write is an upsert keyed on what already exists, so running it twice
 * doesn't duplicate anything. It never deletes.
 *
 * Usage:  DATABASE_URL=<new-host> npx tsx server/scripts/seed-recovered-account.ts
 */

import 'dotenv/config';
import { prisma } from '../db';
import { slugifyChannelName } from '../../channelName';

const OWNER_EMAIL = 'elementalair@gmail.com';

/** Recovered from the Settings screen and subchannel dropdowns captured during UI testing on
 * 2026-08-04/05. `subchannels` lists the names we actually know; `knownSubchannelCount` is what the
 * Settings screen reported at the time, so the gap between them is what has to be re-added by hand
 * in the app (which has an "Add subchannels" flow with suggestions for exactly this). */
const RECOVERED_CHANNELS: { name: string; subchannels: string[]; knownSubchannelCount: number }[] = [
  { name: 'Alameda', subchannels: [], knownSubchannelCount: 1 },
  { name: 'Phish', subchannels: [], knownSubchannelCount: 0 },
  { name: 'Tech', subchannels: ['Iphone', 'AI', 'Jobs'], knownSubchannelCount: 3 },
  { name: 'Art', subchannels: [], knownSubchannelCount: 1 },
  { name: 'Politics', subchannels: [], knownSubchannelCount: 2 },
  { name: 'Music', subchannels: [], knownSubchannelCount: 4 },
  { name: 'Photography', subchannels: [], knownSubchannelCount: 1 },
  { name: 'Tour De France', subchannels: [], knownSubchannelCount: 0 },
  { name: 'Unemployment', subchannels: [], knownSubchannelCount: 0 },
];

/** The streak as of the outage. Restored deliberately rather than reset to 0 — it reflects real
 * days the owner actually caught up, and losing it to an infrastructure failure would be a false
 * record in the other direction. */
const RECOVERED_STREAK = 9;

async function main() {
  const user = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: { email: OWNER_EMAIL, displayName: 'Nico', isOwner: true },
  });
  console.log(`owner account: ${user.id} (${user.email})`);

  // Settings and Streak are NOT optional — getSettings/getStreak use findUniqueOrThrow, so every
  // route 400s without them. Same reason the account-isolation test's fixture creates all three.
  await prisma.settings.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, rollTheDiceChannelIds: [], onboardingCompleted: true },
  });
  await prisma.streak.upsert({
    where: { userId: user.id },
    update: { current: RECOVERED_STREAK },
    create: { userId: user.id, current: RECOVERED_STREAK, lastCaughtUpDate: new Date() },
  });
  console.log(`settings + streak ready (streak restored to ${RECOVERED_STREAK})`);

  let missingSubchannels = 0;
  for (const [i, spec] of RECOVERED_CHANNELS.entries()) {
    const slug = slugifyChannelName(spec.name);
    const channel = await prisma.channel.upsert({
      where: { userId_slug: { userId: user.id, slug } },
      update: {},
      create: { userId: user.id, name: spec.name, slug, sortOrder: i },
    });

    for (const subName of spec.subchannels) {
      const existing = await prisma.subchannel.findFirst({
        where: { channelId: channel.id, name: subName },
      });
      if (!existing) {
        await prisma.subchannel.create({
          data: { userId: user.id, channelId: channel.id, name: subName },
        });
      }
    }

    const gap = spec.knownSubchannelCount - spec.subchannels.length;
    missingSubchannels += gap;
    console.log(
      `  ${spec.name}: ${spec.subchannels.length}/${spec.knownSubchannelCount} subchannels` +
        (gap > 0 ? `  <-- ${gap} name(s) not recoverable, re-add in the app` : '')
    );
  }

  console.log(`\n${RECOVERED_CHANNELS.length} channels ready.`);
  if (missingSubchannels > 0) {
    console.log(
      `${missingSubchannels} subchannel name(s) could not be recovered — add them via ` +
        `Settings > Channels > Manage subchannels, or the channel view's Subchannels dropdown.`
    );
  }
  console.log('Stories will refill on the next refresh (manual, or the scheduled job once re-enabled).');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
