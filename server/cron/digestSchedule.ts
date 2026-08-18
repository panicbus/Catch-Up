/** Pure scheduling logic for the digest cron job — split out from digest.ts specifically so it can
 * be unit-tested without importing digest.ts itself, which self-invokes its whole job (a real
 * database query, and potentially a real email send) the instant it's imported, side-effect-free
 * module or not. Nothing here touches the database, the network, or the clock beyond what's passed
 * in. */

/** The account's current hour-of-day (0-23) and calendar date (YYYY-MM-DD) in ITS OWN timezone —
 * not the server's. `en-CA` formats as YYYY-MM-DD directly, exactly the shape lastDigestSentDate
 * needs to be compared against. Throws on an invalid IANA zone name — callers treat that as "skip
 * this account," not a job-ending error. */
export function localHourAndDate(timezone: string): { hour: number; date: string } {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  return { hour, date };
}

/** Is this account due for its digest right now? True once the local hour has REACHED the
 * configured send hour (not an exact match) on a local day it hasn't already been sent — so a
 * delayed run doesn't cause a silent skip for the rest of the day. GitHub Actions scheduled runs
 * are well known to fire late, sometimes by many minutes; an exact-hour comparison meant a run
 * that slipped past the top of the hour would never match that account again until the same time
 * the next day. Combined with the caller only recording lastDigestSentDate on a real send, this
 * makes the job self-catching-up: whichever hourly run is the FIRST to see "hour has arrived, not
 * sent today" sends it, and every later run that same day is blocked by the dedupe check instead.
 * Residual, accepted gap: a run delayed across a LOCAL MIDNIGHT boundary relative to a late-evening
 * send hour (e.g. 23) would still miss that day, since the date comparison resets at midnight too —
 * narrower than the realistic minutes-scale delays this is actually built to absorb, not worth a
 * rolling cross-day window for. */
export function isDigestDue(hour: number, digestSendHour: number, lastSentDate: string | null, today: string): boolean {
  if (hour < digestSendHour) return false;
  return lastSentDate !== today;
}
