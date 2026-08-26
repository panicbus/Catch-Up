import { describe, it, expect } from 'vitest';
import { shouldSkipOffHoursRun } from './refreshSchedule';

// All times below are given in UTC and chosen against a known Eastern offset for the date, so each
// case states in its own comment what that UTC instant actually is in Eastern local time.
describe('shouldSkipOffHoursRun', () => {
  it('never skips outside the off-hours window (7am ET, standard time)', () => {
    expect(shouldSkipOffHoursRun(new Date('2026-01-15T12:00:00Z'))).toBe(false);
  });

  it('does not skip the first half-hour of the window (3:00am ET, standard time)', () => {
    expect(shouldSkipOffHoursRun(new Date('2026-01-15T08:00:00Z'))).toBe(false);
  });

  it('skips the second half-hour of the window (3:30am ET, standard time)', () => {
    expect(shouldSkipOffHoursRun(new Date('2026-01-15T08:30:00Z'))).toBe(true);
  });

  it('does not skip right at the end boundary (6:00am ET, standard time)', () => {
    expect(shouldSkipOffHoursRun(new Date('2026-01-15T11:00:00Z'))).toBe(false);
  });

  it('skips the last half-hour before the boundary (5:30am ET, standard time)', () => {
    expect(shouldSkipOffHoursRun(new Date('2026-01-15T10:30:00Z'))).toBe(true);
  });

  it('does not skip just before the window opens (2:30am ET, standard time)', () => {
    expect(shouldSkipOffHoursRun(new Date('2026-01-15T07:30:00Z'))).toBe(false);
  });

  it('tracks the DST switch instead of a fixed UTC offset (3:30am ET, daylight time)', () => {
    // In August, Eastern is UTC-4, not the UTC-5 standard-time offset used above. This same UTC
    // hour (08:30) is only 4:30am ET here, still inside the window and still the skip half.
    expect(shouldSkipOffHoursRun(new Date('2026-08-15T08:30:00Z'))).toBe(true);
    // The literal 3:30am ET moment in August falls an hour earlier in UTC than it does in January.
    expect(shouldSkipOffHoursRun(new Date('2026-08-15T07:30:00Z'))).toBe(true);
  });

  it('is robust to a scheduler delay landing off the :00/:30 mark, as long as it stays within its half-hour', () => {
    // A run meant for 3:00am ET that actually fires a few minutes late should still count as the
    // "first half" run, not accidentally skip.
    expect(shouldSkipOffHoursRun(new Date('2026-01-15T08:07:00Z'))).toBe(false);
  });

  it('defaults to the real current time when called with no argument', () => {
    expect(() => shouldSkipOffHoursRun()).not.toThrow();
  });
});
