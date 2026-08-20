import { describe, it, expect } from 'vitest';
import { groupByDay, groupByDayWith } from './groupByDay';

// Fixed local-noon timestamps so these can't straddle a UTC midnight and land in a neighbouring
// bucket depending on the machine's timezone — the exact hazard localDateString exists to avoid.
const at = (localDate: string) => new Date(`${localDate}T12:00:00`).toISOString();

describe('groupByDay', () => {
  it('buckets by local calendar day, newest day first', () => {
    const items = [
      { id: 'a', when: at('2026-08-20') },
      { id: 'b', when: at('2026-08-18') },
      { id: 'c', when: at('2026-08-20') },
    ];
    expect([...groupByDay(items, 'when').keys()]).toEqual(['2026-08-20', '2026-08-18']);
  });

  it('sorts newest-first within a day', () => {
    const items = [
      { id: 'early', when: new Date('2026-08-20T09:00:00').toISOString() },
      { id: 'late', when: new Date('2026-08-20T17:00:00').toISOString() },
    ];
    const day = groupByDay(items, 'when').get('2026-08-20')!;
    expect(day.map((i) => i.id)).toEqual(['late', 'early']);
  });
});

describe('groupByDayWith', () => {
  it('groups by a derived value rather than a field', () => {
    const items = [{ id: 'a', readAt: null as string | null, publishedAt: at('2026-08-19') }];
    const byDay = groupByDayWith(items, (i) => i.readAt ?? i.publishedAt);
    expect([...byDay.keys()]).toEqual(['2026-08-19']);
  });

  it('keeps a story with no read date out of the Unix-epoch bucket — the regression this exists for', () => {
    // A story archived locally reaches the read archive a full poll cycle before the server fills in
    // its readAt. Grouping on the raw null put every such story in a phantom 1969/1970 group pinned
    // to the bottom of the archive; a resolved fallback keeps them in today's bucket instead.
    const today = at('2026-08-20');
    const items = [
      { id: 'confirmed', readAt: at('2026-08-20') as string | null },
      { id: 'localOnly', readAt: null as string | null },
    ];
    const byDay = groupByDayWith(items, (i) => i.readAt ?? today);
    expect([...byDay.keys()]).toEqual(['2026-08-20']);
    expect(byDay.get('2026-08-20')!).toHaveLength(2);
    // Guards the actual failure mode directly, not just the happy path.
    expect([...byDay.keys()].some((k) => k.startsWith('1969') || k.startsWith('1970'))).toBe(false);
  });

  it('still produces the epoch bucket if a null is passed through unresolved (documents WHY the fallback is required)', () => {
    const items = [{ id: 'x', readAt: null as string | null }];
    const byDay = groupByDayWith(items, (i) => i.readAt as unknown as string);
    const key = [...byDay.keys()][0];
    expect(key.startsWith('1969') || key.startsWith('1970')).toBe(true);
  });
});
