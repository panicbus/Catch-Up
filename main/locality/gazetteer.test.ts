import { describe, it, expect } from 'vitest';
import { resolveCity, looksLikePlaceChannel, lookupCity } from './gazetteer';

describe('resolveCity', () => {
  it('resolves a qualified city with a US state abbreviation', () => {
    const result = resolveCity('Los Angeles, CA');
    expect(result).toEqual({ label: 'Los Angeles, CA, US', lat: 34.05223, lon: -118.24368 });
  });

  it('resolves a qualified city with a full US state name', () => {
    const result = resolveCity('Los Angeles, California');
    expect(result?.label).toBe('Los Angeles, CA, US');
  });

  it('resolves the motivating example: Banff by Canadian province abbreviation', () => {
    const result = resolveCity('Banff, AB');
    expect(result).toEqual({ label: 'Banff, AB, CA', lat: 51.17622, lon: -115.56982 });
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
