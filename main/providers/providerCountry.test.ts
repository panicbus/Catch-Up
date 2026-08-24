import { describe, it, expect } from 'vitest';
import {
  newsdataCountry,
  gnewsCountry,
  guardianProductionOffice,
  guardianSection,
  googleNewsLocale,
  GOOGLE_NEWS_DEFAULT_LOCALE,
} from './providerCountry';

describe('newsdataCountry / gnewsCountry — lowercase ISO, allowlisted', () => {
  it('lowercases a supported code', () => {
    expect(newsdataCountry('US')).toBe('us');
    expect(gnewsCountry('GB')).toBe('gb');
  });

  it('returns null for an unsupported or missing code, so the caller omits the param entirely', () => {
    // Omitting the param is the ONLY safe fallback: these APIs ignore an unknown country rather than
    // erroring, so sending one costs a request and silently returns worldwide results anyway.
    expect(newsdataCountry('ZZ')).toBeNull();
    expect(newsdataCountry(null)).toBeNull();
    expect(newsdataCountry(undefined)).toBeNull();
    expect(gnewsCountry('ZZ')).toBeNull();
    expect(gnewsCountry(null)).toBeNull();
  });
});

describe('guardianProductionOffice — editorial desks, NOT ISO codes', () => {
  it('maps the three real offices', () => {
    expect(guardianProductionOffice('GB')).toBe('uk');
    expect(guardianProductionOffice('US')).toBe('us');
    expect(guardianProductionOffice('AU')).toBe('aus');
  });

  it('maps AU to "aus", never the ISO "au"', () => {
    // Verified live: production-office=au returns HTTP 200 with ZERO results — a silent emptying of
    // the provider, not an error. This assertion is the guard against "just lowercase it."
    expect(guardianProductionOffice('AU')).not.toBe('au');
  });

  it('returns null for any country without a Guardian desk', () => {
    expect(guardianProductionOffice('FR')).toBeNull();
    expect(guardianProductionOffice('IN')).toBeNull();
    expect(guardianProductionOffice(null)).toBeNull();
  });
});

describe('guardianSection — must co-vary with the office', () => {
  // The Guardian's `politics` section is UK politics. Verified live: section=politics combined with
  // production-office=us matched 52 articles total, vs 11,271 for section=us-news|politics. Setting
  // the office without widening the section is strictly worse than not narrowing at all.
  it('widens politics to us-news for the US office', () => {
    expect(guardianSection('politics', 'us', 'politics')).toBe('us-news|politics');
  });

  it('widens politics to australia-news for the AUS office', () => {
    expect(guardianSection('politics', 'aus', 'politics')).toBe('australia-news|politics');
  });

  it('leaves politics alone for the UK office, whose politics section already means UK politics', () => {
    expect(guardianSection('politics', 'uk', 'politics')).toBe('politics');
  });

  it('leaves politics alone when there is no office at all (unchanged from before country scoping)', () => {
    expect(guardianSection('politics', null, 'politics')).toBe('politics');
  });

  it('does not touch non-politics sections, which are shared across editions', () => {
    expect(guardianSection('business', 'us', 'business')).toBe('business');
    expect(guardianSection('technology', 'us', 'technology')).toBe('technology');
  });

  it('stays undefined when the category maps to no section, so no section param is sent', () => {
    expect(guardianSection('politics', 'us', undefined)).toBeUndefined();
    expect(guardianSection(null, 'us', undefined)).toBeUndefined();
  });
});

describe('googleNewsLocale — English editions only', () => {
  it('follows the home country where Google has an English edition', () => {
    expect(googleNewsLocale('GB')).toEqual({ hl: 'en-GB', gl: 'GB', ceid: 'GB:en' });
    expect(googleNewsLocale('IN')).toEqual({ hl: 'en-IN', gl: 'IN', ceid: 'IN:en' });
  });

  it('falls back to en-US for a country with no English edition, rather than building en-FR', () => {
    // gl=FR&hl=en-FR is a plausible-looking combination that returns a nearly empty feed — worse
    // than the hardcoded US default this replaced, hence the fallback rather than derivation.
    expect(googleNewsLocale('FR')).toEqual(GOOGLE_NEWS_DEFAULT_LOCALE);
    expect(googleNewsLocale('JP')).toEqual(GOOGLE_NEWS_DEFAULT_LOCALE);
  });

  it('falls back to en-US when no country is set at all — the pre-existing behavior', () => {
    expect(googleNewsLocale(null)).toEqual(GOOGLE_NEWS_DEFAULT_LOCALE);
    expect(googleNewsLocale(undefined)).toEqual(GOOGLE_NEWS_DEFAULT_LOCALE);
    expect(GOOGLE_NEWS_DEFAULT_LOCALE).toEqual({ hl: 'en-US', gl: 'US', ceid: 'US:en' });
  });
});
