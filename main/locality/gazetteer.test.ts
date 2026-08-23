import { describe, it, expect } from 'vitest';
import {
  resolveCity,
  looksLikePlaceChannel,
  lookupCity,
  lookupCountry,
  lookupContinent,
  continentOfCountry,
  countryDisplayName,
  lookupRegion,
  subchannelCountryCode,
} from './gazetteer';

describe('resolveCity', () => {
  it('resolves a qualified city with a US state abbreviation', () => {
    const result = resolveCity('Los Angeles, CA');
    expect(result).toEqual({ label: 'Los Angeles, CA, US', lat: 34.05223, lon: -118.24368, countryCode: 'US' });
  });

  it('resolves a qualified city with a full US state name', () => {
    const result = resolveCity('Los Angeles, California');
    expect(result?.label).toBe('Los Angeles, CA, US');
  });

  it('resolves the motivating example: Banff by Canadian province abbreviation', () => {
    const result = resolveCity('Banff, AB');
    expect(result).toEqual({ label: 'Banff, AB, CA', lat: 51.17622, lon: -115.56982, countryCode: 'CA' });
  });

  it('resolves Banff by full province name too', () => {
    const result = resolveCity('Banff, Alberta');
    expect(result?.label).toBe('Banff, AB, CA');
  });

  it('resolves a plain two-letter ISO country code qualifier', () => {
    const result = resolveCity('Paris, FR');
    expect(result?.label).toContain('FR');
  });

  it('resolves a full country-name qualifier via the alias table', () => {
    const result = resolveCity('Toronto, Canada');
    expect(result?.label).toBe('Toronto, ON, CA');
  });

  it('falls back to the highest-population candidate for an ambiguous bare name', () => {
    // Several US Springfields exist; Springfield, MO is the most populous.
    const result = resolveCity('Springfield');
    expect(result?.label).toBe('Springfield, MO, US');
  });

  it('narrows an ambiguous name correctly when a qualifier is given', () => {
    const result = resolveCity('Springfield, OR');
    expect(result?.label).toBe('Springfield, OR, US');
  });

  it('falls back to population ranking when the qualifier matches nothing', () => {
    // "Zzzznotarealstate" matches no candidate's qualifier, so this should NOT return null —
    // it should fall back to the population-best candidate rather than treating an unmatched
    // qualifier as a hard failure.
    const result = resolveCity('Springfield, Zzzznotarealstate');
    expect(result?.label).toBe('Springfield, MO, US');
  });

  it('returns null for a city that does not exist in the gazetteer', () => {
    expect(resolveCity('Nonexistentville')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(resolveCity('')).toBeNull();
    expect(resolveCity('   ')).toBeNull();
  });

  it('is case-insensitive and trims whitespace', () => {
    const result = resolveCity('  bAnFF , ab  ');
    expect(result?.label).toBe('Banff, AB, CA');
  });

  it('resolves a comma-less "City State" phrasing by retrying the last word as a qualifier', () => {
    // The exact real-world input that used to silently fail: no comma, lowercase, despite the
    // Settings UI's own "City, State" placeholder hint. Confirmed live this returned null before
    // the fallback existed, which (via a since-fixed server bug) got saved as a broken location.
    const result = resolveCity('Alameda ca');
    expect(result).toEqual({ label: 'Alameda, CA, US', lat: 37.77099, lon: -122.26087, countryCode: 'US' });
  });

  it('still resolves a genuine multi-word bare city name with no comma, not just its last word', () => {
    // The direct (whole-string) attempt must win here — the last-word-as-qualifier fallback would
    // instead try city="mexico", qualifier="city", which shouldn't be reached at all.
    const result = resolveCity('Mexico City');
    expect(result?.label).toBe('Mexico City, Mexico City, MX');
  });

  it('returns null for comma-less input where neither the whole string nor a last-word split match', () => {
    expect(resolveCity('Nonexistent Placeville')).toBeNull();
  });
});

describe('looksLikePlaceChannel', () => {
  it('is false for a plain topic/entity channel name', () => {
    expect(looksLikePlaceChannel('Wildfires')).toBe(false);
    expect(looksLikePlaceChannel('Phish')).toBe(false);
  });

  it('is true for a channel named after a country', () => {
    expect(looksLikePlaceChannel('Ukraine')).toBe(true);
  });

  it('is true for a multi-word channel name containing a real, large city token', () => {
    expect(looksLikePlaceChannel('Paris Olympics')).toBe(true);
  });

  it('is false for a channel name that only coincidentally matches a tiny, low-population place', () => {
    // Regression guard for the PLACE_CHANNEL_MIN_POP floor: an obscure hamlet sharing a common
    // word shouldn't be enough to disable locality scoring for an unrelated topic channel.
    expect(looksLikePlaceChannel('Music')).toBe(false);
  });

  it('is true for a channel named after a continent', () => {
    expect(looksLikePlaceChannel('Africa')).toBe(true);
  });
});

describe('lookupCity', () => {
  it('is case-insensitive and used as the shared index for placeExtraction', () => {
    expect(lookupCity('Banff')?.some((r) => r.cc === 'CA')).toBe(true);
    expect(lookupCity('BANFF')?.some((r) => r.cc === 'CA')).toBe(true);
  });

  it('returns undefined for a name with no gazetteer entry', () => {
    expect(lookupCity('Nonexistentville')).toBeUndefined();
  });
});

describe('lookupCountry', () => {
  it('resolves common country names, case-insensitively', () => {
    expect(lookupCountry('India')).toBe('IN');
    expect(lookupCountry('india')).toBe('IN');
    expect(lookupCountry('Nigeria')).toBe('NG');
    expect(lookupCountry('South Africa')).toBe('ZA');
  });

  it('returns null for an unrecognized phrase', () => {
    expect(lookupCountry('Nonexistentland')).toBeNull();
  });

  it('deliberately does NOT match a bare two-letter code (collides with common words like "In"/"It")', () => {
    expect(lookupCountry('In')).toBeNull();
    expect(lookupCountry('It')).toBeNull();
  });

  it('DOES match "US" specifically, but only when fully capitalized', () => {
    expect(lookupCountry('US')).toBe('US');
    // Sentence-initial capitalization only (first letter, not both) must NOT match — that's the
    // exact "Us Weekly"/ordinary-word collision this stricter check exists to avoid.
    expect(lookupCountry('Us')).toBeNull();
  });

  it('"uk" (lowercase) already matches via the plain alias table, case-insensitively like every other alias', () => {
    // Unlike "us", "uk" isn't an ordinary English word, so the existing case-insensitive alias
    // lookup was always safe for it — no special ALL-CAPS-only handling needed the way "US" gets.
    expect(lookupCountry('UK')).toBe('GB');
    expect(lookupCountry('Uk')).toBe('GB');
  });

  it('deliberately excludes "Georgia" (collides with the US state)', () => {
    expect(lookupCountry('Georgia')).toBeNull();
  });

  it('aliases US territories to the US rather than their own code', () => {
    expect(lookupCountry('Puerto Rico')).toBe('US');
    expect(lookupCountry('Guam')).toBe('US');
  });
});

describe('lookupContinent / continentOfCountry', () => {
  it('resolves a continent name, case-insensitively', () => {
    expect(lookupContinent('Africa')).toBe('Africa');
    expect(lookupContinent('africa')).toBe('Africa');
  });

  it('returns null for a non-continent phrase', () => {
    expect(lookupContinent('India')).toBeNull();
  });

  it('resolves the continent of a known country code', () => {
    expect(continentOfCountry('IN')).toBe('Asia');
    expect(continentOfCountry('NG')).toBe('Africa');
    expect(continentOfCountry('US')).toBe('North America');
  });

  it('returns null for a code outside CONTINENT_BY_CC\'s coverage rather than guessing', () => {
    expect(continentOfCountry('ZZ')).toBeNull();
  });
});

describe('countryDisplayName', () => {
  it('returns a natural display name for a known code', () => {
    expect(countryDisplayName('US')).toBe('the United States');
    expect(countryDisplayName('IN')).toBe('India');
  });

  it('returns null for an unrecognized code rather than a raw ISO code', () => {
    expect(countryDisplayName('ZZ')).toBeNull();
  });
});

describe('lookupRegion', () => {
  it('resolves an Indian state that has no gazetteer city entry of its own', () => {
    expect(lookupCity('Kerala')).toBeUndefined();
    expect(lookupRegion('Kerala')).toEqual(['IN']);
  });

  it('resolves a Nigerian state whose admin1 value is suffixed "State" in the bundled data', () => {
    expect(lookupCity('Osun')).toBeUndefined();
    expect(lookupRegion('Osun')).toEqual(['NG']);
  });

  it('is case-insensitive', () => {
    expect(lookupRegion('kerala')).toEqual(['IN']);
    expect(lookupRegion('OSUN')).toEqual(['NG']);
  });

  it('returns undefined for a name with no admin1 entry', () => {
    expect(lookupRegion('Nonexistentregionville')).toBeUndefined();
  });

  it('collects every country for a region name that genuinely repeats across borders', () => {
    // Punjab is a real province in both Pakistan and India — collect-all is the correct behavior
    // here, not a bug; subchannelCountryCode below is what refuses to guess between them.
    expect(lookupRegion('Punjab')?.sort()).toEqual(['IN', 'PK']);
  });

  it('excludes generic/directional words that are also literal admin1 values in the bundled data', () => {
    // Regression guard for the curated ADM1_EXCLUDE list — these would otherwise misfire on
    // completely unrelated domestic coverage ("the East Coast", "Central bank", "raise the Bar").
    expect(lookupRegion('East')).toBeUndefined();
    expect(lookupRegion('Central')).toBeUndefined();
    expect(lookupRegion('Bar')).toBeUndefined();
    expect(lookupRegion('Delta')).toBeUndefined();
  });
});

describe('subchannelCountryCode', () => {
  it('resolves a subchannel named after a country', () => {
    expect(subchannelCountryCode('India')).toBe('IN');
    expect(subchannelCountryCode('Nigeria')).toBe('NG');
  });

  it('resolves a subchannel named after a region with no country-name match of its own', () => {
    expect(subchannelCountryCode('Kerala')).toBe('IN');
  });

  it('resolves a multi-word country name as a whole before falling back to individual words', () => {
    expect(subchannelCountryCode('United Kingdom')).toBe('GB');
  });

  it('resolves a subchannel name that PAIRS a country with another word', () => {
    expect(subchannelCountryCode('Nigeria Politics')).toBe('NG');
  });

  it('returns null for a subchannel name that names no place at all', () => {
    expect(subchannelCountryCode('Elections')).toBeNull();
  });

  it('returns null for a region name shared by more than one country, rather than guessing', () => {
    // Punjab is a real province in both Pakistan and India (see lookupRegion's own test above) —
    // subchannelCountryCode refuses to pick one, since a wrong guess here would wrongly exempt or
    // misroute a story rather than just miss it.
    expect(subchannelCountryCode('Punjab')).toBeNull();
  });
});
