import { describe, it, expect } from 'vitest';
import { nearestMentionKm, foreignPlaceSignal, detectStoryCountry } from './placeExtraction';
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

describe('foreignPlaceSignal', () => {
  it("reports 'country' for a story naming a country that isn't home — the real motivating case (no city named at all)", () => {
    expect(foreignPlaceSignal('India announces new trade policy', null, 'US')).toBe('country');
  });

  it('is null when the mentioned country IS home, even if a foreign country is also named', () => {
    expect(foreignPlaceSignal('United States and India sign new trade deal', null, 'US')).toBeNull();
  });

  it('also recognizes the fully-capitalized "US"/"UK" abbreviations as home (confirmed live as a real gap otherwise)', () => {
    expect(foreignPlaceSignal('US and India sign new trade deal', null, 'US')).toBeNull();
    expect(foreignPlaceSignal('UK and India sign new trade deal', null, 'GB')).toBeNull();
  });

  // Known, accepted gap (same spirit as the "no demonym matching" limitation documented in the
  // plan): wordTokens splits on periods, so "U.S." tokenizes into single-letter fragments ("U", "S")
  // that never match lookupCountry's "US" allowlist entry. Not fixed by loosening wordTokens, a
  // shared function nearestMentionKm's city-matching also depends on and already has real, tested
  // behavior around periods (e.g. "St. Louis" tokenizing as "St"/"Louis") — not worth the regression
  // risk for one abbreviation style. The undotted "US" form (also extremely common, and arguably the
  // more common digital-headline style) IS caught — see the test above.
  it('does NOT catch the dotted "U.S." form (documented gap, not a bug to silently fix)', () => {
    expect(foreignPlaceSignal('U.S. and India sign new trade deal', null, 'US')).toBe('country');
  });

  it("reports 'continent' when only a continent is named, and it isn't home's", () => {
    expect(foreignPlaceSignal('Political unrest spreads across Africa', null, 'US')).toBe('continent');
  });

  it("is null when the mentioned continent IS home's own continent", () => {
    expect(foreignPlaceSignal('Political unrest spreads across Europe', null, 'FR')).toBeNull();
  });

  it('is null when no country or continent is mentioned at all', () => {
    expect(foreignPlaceSignal('Lawmakers debate new voting legislation ahead of recess', null, 'US')).toBeNull();
  });

  it('stays silent on the continent tier when the home country has no known continent, rather than guessing', () => {
    expect(foreignPlaceSignal('Political unrest spreads across Africa', null, 'ZZ')).toBeNull();
  });

  it('scans the snippet as well as the title', () => {
    expect(foreignPlaceSignal('Update issued this morning', 'Officials in Nigeria responded to the crisis.', 'US')).toBe('country');
  });

  it('deliberately does not match a lowercase, non-sentence-initial country mention (capitalization gate)', () => {
    expect(foreignPlaceSignal('Officials met to discuss trade with india this week', null, 'US')).toBeNull();
  });
});

describe('detectStoryCountry', () => {
  it("reports 'home' when the mentioned country IS home", () => {
    expect(detectStoryCountry('US lawmakers pass new budget bill', null, 'US')).toEqual({ kind: 'home' });
  });

  it("reports 'foreign' with the specific country code for a named foreign country", () => {
    expect(detectStoryCountry('India announces new trade policy', null, 'US')).toEqual({
      kind: 'foreign',
      countryCode: 'IN',
    });
  });

  it("reports 'home', not 'foreign', when a story names both a foreign country and home", () => {
    // "U.S. signs trade deal with India" is fundamentally a home-country story that happens to
    // name India too, not routine foreign coverage — same leniency foreignPlaceSignal already has.
    expect(detectStoryCountry('United States and India sign new trade deal', null, 'US')).toEqual({
      kind: 'home',
    });
  });

  it("reports 'foreign' for a region with no city or country name of its own (Osun/Kerala) — the actual gap this exists for", () => {
    expect(detectStoryCountry('Osun 2026: Parade of Paradox and Parody of Politics', null, 'US')).toEqual({
      kind: 'foreign',
      countryCode: 'NG',
    });
    expect(
      detectStoryCountry("Politics hasn't changed much in Kerala, says Ramesh Pisharody", null, 'US')
    ).toEqual({ kind: 'foreign', countryCode: 'IN' });
  });

  it('reports \'foreign\' for a city with no region or country name mentioned', () => {
    expect(detectStoryCountry('Protests continue in Lagos over fuel prices', null, 'US')).toEqual({
      kind: 'foreign',
      countryCode: 'NG',
    });
  });

  it("reports 'none' for a bare continent mention with no specific country — deliberately weaker than foreignPlaceSignal's 'continent' tier, left to the existing soft scoring", () => {
    expect(detectStoryCountry('Political unrest spreads across Africa', null, 'US')).toEqual({ kind: 'none' });
  });

  it("reports 'none' when no place of any kind is named — the one gap this function cannot close (a foreign figure's name alone)", () => {
    expect(
      detectStoryCountry('Committee chairman rejects allegations against him', null, 'US')
    ).toEqual({ kind: 'none' });
  });

  it('known accepted false positive: "Bar" is also a real city in Montenegro, so a story that never names a place still resolves as foreign', () => {
    // Same class of limitation nearestMentionKm's own tests already document ("Independence, US",
    // "Man, CI") — the capitalization heuristic is a cheap proper-noun filter, not real NER, and a
    // handful of ordinary English words are also real, populous gazetteer entries. This is the exact
    // headline from the report that motivated this feature ("Bar Council chairman Manan Mishra
    // rejects allegations..."): it gets excluded, just not for the reason a human would give.
    expect(detectStoryCountry('Bar Council chairman rejects allegations against him', null, 'US')).toEqual({
      kind: 'foreign',
      countryCode: 'ME',
    });
  });

  it('scans the snippet as well as the title', () => {
    expect(detectStoryCountry('Update issued this morning', 'Officials in Nigeria responded.', 'US')).toEqual({
      kind: 'foreign',
      countryCode: 'NG',
    });
  });
});
