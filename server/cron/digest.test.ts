import { describe, it, expect } from 'vitest';
import { isDigestDue } from './digestSchedule';

describe('isDigestDue', () => {
  it('is due at the exact configured hour, never sent', () => {
    expect(isDigestDue(7, 7, null, '2026-08-19')).toBe(true);
  });

  it('is still due when the hour has PASSED the configured hour (a delayed cron run), never sent', () => {
    // This is the actual regression case: an exact-match comparison would say "not due" here,
    // and since the next hourly run would also be past 7, it would never fire again until the
    // next day — a real GitHub Actions scheduling delay silently costing a whole day's digest.
    expect(isDigestDue(9, 7, null, '2026-08-19')).toBe(true);
  });

  it('is not due before the configured hour', () => {
    expect(isDigestDue(6, 7, null, '2026-08-19')).toBe(false);
  });

  it('is not due if already sent today, even past the configured hour', () => {
    expect(isDigestDue(9, 7, '2026-08-19', '2026-08-19')).toBe(false);
  });

  it('is due again the next local day even if sent yesterday', () => {
    expect(isDigestDue(7, 7, '2026-08-18', '2026-08-19')).toBe(true);
  });
});
