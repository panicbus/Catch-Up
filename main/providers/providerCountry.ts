/** Pure, Electron-agnostic — same portability contract as the rest of this folder (see types.ts).
 *
 * Maps a home country (uppercase ISO 3166-1 alpha-2, from relevance.ts's providerCountryCode) onto
 * each provider's OWN country parameter format. Deliberately four separate allowlists rather than one
 * `cc.toLowerCase()`, because the formats genuinely differ and — the dangerous part — **an
 * unsupported value does not error**. Verified live against the real APIs: Guardian's
 * `production-office=au` returns HTTP 200 with zero results (the correct value is `aus`), and an
 * unknown Google News `gl` likewise returns a near-empty feed. A wrong value would therefore not fail
 * loudly, it would quietly empty a channel — which is the exact failure mode this whole line of work
 * exists to fix. So: an unmapped country returns null everywhere and the caller omits the parameter,
 * degrading to today's worldwide behavior rather than to nothing. */

import type { NewsCategory } from './channelProfiles';

/** NewsData accepts lowercase ISO alpha-2 (`country=us`). Its coverage list is long and it ignores
 * unknown codes gracefully, but this stays an allowlist for the same reason as the others — a code
 * it silently ignores costs a request and returns worldwide results we'd then throw away. */
const NEWSDATA_COUNTRIES = new Set([
  'us', 'gb', 'ca', 'au', 'ie', 'nz', 'in', 'za', 'sg', 'ph', 'ng', 'ke', 'pk', 'my',
  'de', 'fr', 'it', 'es', 'nl', 'be', 'ch', 'at', 'se', 'no', 'dk', 'fi', 'pl', 'pt',
  'br', 'mx', 'ar', 'cl', 'co', 'jp', 'kr', 'cn', 'hk', 'tw', 'id', 'th', 'vn', 'ae', 'il', 'tr',
]);

/** GNews supports a documented subset of ISO alpha-2 codes; anything outside it is ignored rather
 * than rejected, so this list is the guard. */
const GNEWS_COUNTRIES = new Set([
  'us', 'gb', 'ca', 'au', 'ie', 'nz', 'in', 'za', 'sg', 'ph',
  'de', 'fr', 'it', 'es', 'nl', 'be', 'ch', 'at', 'se', 'no', 'pt', 'gr',
  'br', 'mx', 'ar', 'jp', 'kr', 'cn', 'tw', 'id', 'th', 'ru', 'ua', 'il', 'tr', 'eg', 'ma',
]);

/** Guardian's `production-office` is NOT an ISO code — it names one of three editorial desks. */
const GUARDIAN_OFFICES: Record<string, 'uk' | 'us' | 'aus'> = {
  GB: 'uk',
  US: 'us',
  AU: 'aus',
};

/** Google News RSS locales, English-language editions only. Deliberately not derived from the
 * country code: `gl=FR&hl=en-FR` is a real, valid-looking combination that returns almost nothing,
 * which would be strictly worse than the hardcoded US default this replaces. A country with no
 * English edition falls back to that same default. */
const GOOGLE_NEWS_LOCALES: Record<string, { hl: string; gl: string; ceid: string }> = {
  US: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  GB: { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  CA: { hl: 'en-CA', gl: 'CA', ceid: 'CA:en' },
  AU: { hl: 'en-AU', gl: 'AU', ceid: 'AU:en' },
  IE: { hl: 'en-IE', gl: 'IE', ceid: 'IE:en' },
  NZ: { hl: 'en-NZ', gl: 'NZ', ceid: 'NZ:en' },
  IN: { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
  ZA: { hl: 'en-ZA', gl: 'ZA', ceid: 'ZA:en' },
  SG: { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
  PH: { hl: 'en-PH', gl: 'PH', ceid: 'PH:en' },
  NG: { hl: 'en-NG', gl: 'NG', ceid: 'NG:en' },
  KE: { hl: 'en-KE', gl: 'KE', ceid: 'KE:en' },
};

export const GOOGLE_NEWS_DEFAULT_LOCALE = GOOGLE_NEWS_LOCALES.US;

/** `country=` value for NewsData, or null to omit the parameter. */
export function newsdataCountry(cc: string | null | undefined): string | null {
  if (!cc) return null;
  const lower = cc.toLowerCase();
  return NEWSDATA_COUNTRIES.has(lower) ? lower : null;
}

/** `country=` value for GNews, or null to omit the parameter. */
export function gnewsCountry(cc: string | null | undefined): string | null {
  if (!cc) return null;
  const lower = cc.toLowerCase();
  return GNEWS_COUNTRIES.has(lower) ? lower : null;
}

/** `production-office=` value for the Guardian, or null to omit it. */
export function guardianProductionOffice(cc: string | null | undefined): 'uk' | 'us' | 'aus' | null {
  if (!cc) return null;
  return GUARDIAN_OFFICES[cc.toUpperCase()] ?? null;
}

/** The Guardian's `section=` value, which MUST co-vary with production-office rather than being
 * chosen independently — this is the one provider where the country and category parameters interact.
 * Verified live: the Guardian's `politics` section is UK politics, so `section=politics` combined with
 * `production-office=us` matched 52 articles in total, versus 11,271 for `section=us-news|politics`.
 * Narrowing by office without widening the section is therefore strictly worse than not narrowing at
 * all. `undefined` means "send no section param," matching the previous PROVIDER_CATEGORY behavior
 * for an unmapped category. */
export function guardianSection(
  category: NewsCategory | null | undefined,
  office: 'uk' | 'us' | 'aus' | null,
  baseSection: string | undefined
): string | undefined {
  if (!baseSection) return undefined;
  // Only politics is genuinely edition-scoped this way. Business/tech/science/health sections are
  // shared across the Guardian's editions, so the office param alone narrows them correctly.
  if (category === 'politics' && office === 'us') return 'us-news|politics';
  if (category === 'politics' && office === 'aus') return 'australia-news|politics';
  return baseSection;
}

/** Google News RSS `hl`/`gl`/`ceid`, falling back to the en-US default for any country without an
 * English edition (see GOOGLE_NEWS_LOCALES). */
export function googleNewsLocale(cc: string | null | undefined): { hl: string; gl: string; ceid: string } {
  if (!cc) return GOOGLE_NEWS_DEFAULT_LOCALE;
  return GOOGLE_NEWS_LOCALES[cc.toUpperCase()] ?? GOOGLE_NEWS_DEFAULT_LOCALE;
}
