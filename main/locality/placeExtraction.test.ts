import { describe, it, expect } from 'vitest';
import { nearestMentionKm } from './placeExtraction';
import { resolveCity } from './gazetteer';

const LA = resolveCity('Los Angeles, CA')!;
const CALGARY = resolveCity('Calgary, AB')!;

const BANFF_TITLE = 'Fire ban in effect for Banff, Yoho, and Kootenay national parks';
const BANFF_SNIPPET =
  'These fire bans will be implemented to reduce the likelihood of human-caused wildfires.';

describe('nearestMentionKm — correctness', () => {
  it('finds a place mentioned in the title and measures real distance (far home)', () => {
    const km = nearestMentionKm(BANFF_TITLE, BANFF_SNIPPET, LA);
    expect(km).not.toBeNull();
    expect(km).toBeCloseTo(1916.3, 0);
  });

  it('finds the same place mentioned, close to home', () => {
    const km = nearestMentionKm(BANFF_TITLE, BANFF_SNIPPET, CALGARY);
    expect(km).not.toBeNull();
    expect(km).toBeCloseTo(104.6, 0);
  });

  it('returns null when no place is mentioned anywhere in title or snippet', () => {
    const km = nearestMentionKm(
      'New wildfire prevention guidance issued statewide',
      'Officials urged residents to stay indoors as conditions worsen.',
      LA
    );
    expect(km).toBeNull();
  });

  it('handles a null snippet without throwing', () => {
    expect(() => nearestMentionKm('Wildfire smoke blankets Los Angeles skyline', null, LA)).not.toThrow();
    expect(nearestMentionKm('Wildfire smoke blankets Los Angeles skyline', null, LA)).toBe(0);
  });

  it('scans the snippet as well as the title', () => {
    const km = nearestMentionKm('Wildfire update issued this morning', BANFF_TITLE, LA);
    expect(km).not.toBeNull();
  });

  it('picks the NEAREST mention when multiple different places are named', () => {
    // Banff (~1916km from LA) and Los Angeles itself (0km) both appear — nearest-wins means the
    // 0km match should win, not the first one found or the farthest.
    const km = nearestMentionKm(`${BANFF_TITLE} as Los Angeles crews are sent to help`, BANFF_SNIPPET, LA);
    expect(km).toBe(0);
  });

  it('resolves a two-word place name ("Los Angeles")', () => {
    expect(nearestMentionKm('Wildfire smoke blankets Los Angeles skyline', null, CALGARY)).not.toBeNull();
  });

  it('does NOT match a place name that appears lowercase mid-sentence (capitalization gate)', () => {
    // "banff" here is deliberately lowercase and NOT sentence-initial — the proper-noun heuristic
    // should reject it even though "Banff" is a real, indexed place.
    const km = nearestMentionKm('Crews report the banff area fire is now fully contained', null, LA);
    expect(km).toBeNull();
  });
});

describe('nearestMentionKm — known accepted false positives (documented, not silently fixed)', () => {
  // The capitalization heuristic is a cheap proper-noun filter, not a real NER model — a handful of
  // ordinary English words are ALSO real, populous gazetteer entries, and a sentence-initial
  // capital (a normal thing for any word starting a headline/sentence) can't be told apart from a
  // genuine place mention this way. These are accepted, documented limitations (see
  // placeExtraction.ts's header comment) — if a future gazetteer refresh or smarter heuristic
  // changes this, that's a heuristic improvement worth noticing, not a test to silently delete.
  it.each([
    ['Independence Day fireworks planned downtown', 'Independence, US'],
    ['Man reported missing after storm', 'Man, CI'],
    ['Normal traffic patterns expected to resume', 'Normal, US'],
  ])('%s -> known false-positive match on %s', (text) => {
    expect(nearestMentionKm(text, null, LA)).not.toBeNull();
  });
});

describe('nearestMentionKm — true negatives (common capitalized words that do NOT collide)', () => {
  it.each(['The', 'New', 'So', 'Us', 'Good', 'Christmas', 'Friendship'])(
    '"%s" at the start of a headline does not false-positive',
    (word) => {
      expect(nearestMentionKm(`${word} team wins the championship tonight`, null, LA)).toBeNull();
    }
  );
});

describe('nearestMentionKm — performance', () => {
  it('processes a large batch of articles well within a sane latency budget', () => {
    const home = LA;
    const articles = Array.from({ length: 2000 }, (_, i) => ({
      title: `Fire ban in effect for Banff, Yoho, and Kootenay national parks (update ${i})`,
      snippet: BANFF_SNIPPET,
    }));

    const start = performance.now();
    for (const a of articles) nearestMentionKm(a.title, a.snippet, home);
    const elapsed = performance.now() - start;

    // Observed baseline is ~0.02ms/call (~40ms for 2000 calls) — 500ms gives ~12x headroom for a
    // slower CI machine while still catching a real regression (e.g. an accidental full-gazetteer
    // scan per call instead of the O(1) map lookups this is supposed to do).
    expect(elapsed).toBeLessThan(500);
  });
});
