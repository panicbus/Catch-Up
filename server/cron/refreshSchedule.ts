/** Pure scheduling logic for the refresh cron job, split out from refresh.ts specifically so it can
 * be unit-tested without importing refresh.ts itself, which self-invokes its whole job (a real
 * database query, and potentially real provider calls) the instant it's imported. Nothing here
 * touches the database, the network, or the clock beyond what's passed in. */

const OFF_HOURS_START = 3; // 3am Eastern
const OFF_HOURS_END = 6; // 6am Eastern

/** The current hour-of-day (0-23) in America/New_York, DST-aware. Read via Intl rather than a
 * fixed UTC offset so "3am-6am Eastern" stays correct across the DST switch instead of quietly
 * drifting an hour twice a year. */
function easternHour(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour) % 24;
}

/** Should this particular invocation of the scheduled job no-op? refresh.yml fires every 30
 * minutes regardless; skipping the second half of every off-hours clock hour (3am-6am Eastern,
 * this app's quietest window) halves the real run count there, which doubles the effective
 * interval between fetches from 30 to 60 minutes without touching the schedule itself. Minutes
 * don't need their own timezone conversion: EST/EDT are both whole-hour offsets from UTC, so the
 * minute-of-hour is the same number in either zone. */
export function shouldSkipOffHoursRun(now: Date = new Date()): boolean {
  const hour = easternHour(now);
  const inOffHours = hour >= OFF_HOURS_START && hour < OFF_HOURS_END;
  return inOffHours && now.getUTCMinutes() >= 30;
}
