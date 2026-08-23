/** Pure, Electron-agnostic place-mention scanner — same portability contract as gazetteer.ts.
 *
 * There is no location field anywhere in this app's article data (see providers/types.ts) — a
 * story's only text is its title + snippet. This scans that raw text for capitalized words/phrases
 * that match a real place in the bundled gazetteer, and reports how far the nearest one is from the
 * user's home location. Deliberately conservative in both directions:
 *   - requires the match to start with a capital letter, a free proper-noun filter that cuts a lot
 *     of false positives on ordinary lowercase words that happen to also be city names,
 *   - a single-word match additionally requires a reasonably large place (short common words collide
 *     with obscure small-town names far more often than multi-word phrases do),
 *   - when several places share a mentioned name (there are many Springfields), the NEAREST of them
 *     to home is used — a false negative (missing a genuinely distant story) is a much better
 *     failure mode here than a false positive (burying a story that wasn't actually distant). */

import { lookupCity, lookupCountry, lookupContinent, continentOfCountry, lookupRegion, type CityRow, type Continent } from './gazetteer';
import { normalizeTitle } from '../providers/dedupe';

// TUNABLE: originally set much higher (50,000) to filter single-word false positives (ordinary
// English words that double as obscure place names), but that floor silently excluded Banff, AB
// (pop. ~8,300) — this feature's own motivating example — since real "local news" datelines are
// very often small towns. Left at the gazetteer's own floor (every row is already population >
// 5,000) rather than layering on an extra one; capitalization is the main noise filter instead.
const SINGLE_WORD_MIN_POP = 0;
const MAX_NGRAM_WORDS = 3;
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Word tokens, keeping original casing (so the capitalization check downstream still works) and
 * internal apostrophes/hyphens ("O'Brien", "Wilkes-Barre"), but splitting on everything else. */
function wordTokens(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
}

function isCapitalized(word: string): boolean {
  return /^[A-Z]/.test(word);
}

/** Rows worth treating as a real mention: a multi-word match is specific enough to trust outright;
 * a single-word match needs a real, well-known place behind it. */
function eligibleRows(rows: CityRow[], wordCount: number): CityRow[] {
  if (wordCount > 1) return rows;
  return rows.filter((r) => r.pop >= SINGLE_WORD_MIN_POP);
}

/** Every capitalized-starting 1-to-`maxWords`-word window in `text`, in the same left-to-right,
 * shortest-to-longest order the original inlined loop scanned — shared by nearestMentionKm (city
 * lookup) and foreignPlaceSignal (country/continent lookup) below so both scan text exactly the
 * same way rather than keeping two copies of this loop in sync. */
function* capitalizedPhrases(text: string, maxWords: number): Generator<{ phrase: string; wordCount: number }> {
  const words = wordTokens(text);
  for (let start = 0; start < words.length; start++) {
    if (!isCapitalized(words[start])) continue;
    for (let len = 1; len <= maxWords && start + len <= words.length; len++) {
      yield { phrase: words.slice(start, start + len).join(' '), wordCount: len };
    }
  }
}

/** Distance (km) from `home` to the nearest gazetteer place mentioned in `title`/`snippet`, or
 * null if no eligible mention was found. Scans 1-, 2-, and 3-word windows over both fields. */
export function nearestMentionKm(
  title: string,
  snippet: string | null,
  home: { lat: number; lon: number }
): number | null {
  let nearest: number | null = null;

  for (const text of [title, snippet ?? '']) {
    for (const { phrase, wordCount } of capitalizedPhrases(text, MAX_NGRAM_WORDS)) {
      const rows = lookupCity(phrase);
      if (!rows) continue;
      for (const row of eligibleRows(rows, wordCount)) {
        const km = haversineKm(home.lat, home.lon, row.lat, row.lon);
        if (nearest === null || km < nearest) nearest = km;
      }
    }
  }

  return nearest;
}

export type ForeignPlaceKind = 'country' | 'continent' | null;

/** Does this story name a country or continent that ISN'T the user's home — the country/continent
 * counterpart to nearestMentionKm's city-level check, used by relevance.ts's foreign-country
 * locality signal. Only consulted when nearestMentionKm found no CITY match at all (see
 * relevance.ts's scoring block) — a story naming both "Mumbai" and "India" shouldn't stack two
 * separate penalties for the same underlying fact.
 *
 * Collects EVERY distinct country/continent mentioned, not just the first, so a story that also
 * mentions the user's own home country isn't flagged as foreign — "U.S. signs trade deal with
 * India" is fundamentally still a home-country story that happens to name India too, not routine
 * foreign coverage. Only when NONE of the mentioned countries is home does this report 'country';
 * only when a continent is named and it isn't the user's own home continent does it report
 * 'continent' — and when we can't even determine the home continent (see gazetteer.ts's
 * CONTINENT_BY_CC coverage note), the continent tier just stays silent rather than guessing. */
export function foreignPlaceSignal(
  title: string,
  snippet: string | null,
  homeCountryCode: string
): ForeignPlaceKind {
  const countryCodes = new Set<string>();
  const continents = new Set<Continent>();

  for (const text of [title, snippet ?? '']) {
    for (const { phrase } of capitalizedPhrases(text, MAX_NGRAM_WORDS)) {
      const cc = lookupCountry(phrase);
      if (cc) countryCodes.add(cc);
      const continent = lookupContinent(phrase);
      if (continent) continents.add(continent);
    }
  }

  if (countryCodes.size > 0) {
    return countryCodes.has(homeCountryCode.toUpperCase()) ? null : 'country';
  }
  if (continents.size > 0) {
    const homeContinent = continentOfCountry(homeCountryCode);
    if (homeContinent === null) return null;
    return continents.has(homeContinent) ? null : 'continent';
  }
  return null;
}

export type StoryPlace =
  | { kind: 'home' }
  | { kind: 'foreign'; countryCode: string }
  | { kind: 'none' };

/** Same scan as foreignPlaceSignal, but resolves to a specific COUNTRY rather than a soft near/far
 * distance or a country-vs-continent tier — used by relevance.ts's hard exclude for the Politics
 * category (see that file), which needs an actual country code to check against a channel's
 * subchannels, not just "this is foreign." Deliberately a separate function rather than a shared
 * refactor of foreignPlaceSignal/nearestMentionKm: those two stay exactly as they were, still scoring
 * Business/Health/Science/Technology exactly as before — this one is Politics-only, all-new
 * consumers, and safest kept apart from code with years of tuned test coverage riding on it.
 *
 * Checks city, admin1 (state/province — the gap neither of the two functions above closes: "Osun"
 * and "Kerala" are real Nigerian/Indian regions but aren't in the gazetteer as CITY names, see
 * gazetteer.ts's BY_ADM1), and country name/alias matches uniformly, and — like foreignPlaceSignal —
 * never flags a story as foreign if it ALSO names the home country somewhere ("U.S. signs trade deal
 * with India" is a home-country story that happens to name India too, not routine foreign coverage).
 *
 * Deliberately narrower than foreignPlaceSignal in one respect: a bare CONTINENT mention with no
 * specific country ("political unrest spreads across Africa") reports 'none' here, not 'foreign' —
 * continent-only evidence is exactly the weaker signal foreignPlaceSignal's own -5-vs--7 weighting
 * already treats as less confident than a named country, and the hard exclude this feeds is not the
 * place to escalate that; a bare continent mention keeps going through the existing soft scoring
 * unchanged. There's also no single country code to check a subchannel against for a continent. */
// Confirmed live as a severe false-positive source, not a hypothetical: "Senate approves new
// sanctions package targeting Russia," "Lawmakers debate new aid package for Ukraine," "Congress
// moves to restrict TikTok over China ties" — genuine, common domestic political coverage that
// discusses foreign policy, which is most of what a real "Politics" feed carries. None of these need
// to say "United States" — a story about the US Senate doesn't need to also name the country — so
// the plain "mentions home too" check above never sees it, and the story reads as nothing but a
// foreign-country mention. A hard exclude with no escape hatch turned that gap into blocking the
// majority of a Politics channel's real content, not just the regional coverage this was built for.
//
// Deliberately a curated per-country term list, not a blanket "any political-institution word,"
// and deliberately narrow even within that: ordinary political-science vocabulary (parliament,
// president, governor, "the Senate"/"the Congress" as generic legislature names) is excluded on
// purpose because it isn't home-specific — Nigeria's National Assembly has its own Senate, and
// India's ruling/opposition party is literally named "Congress," both of which are exactly the
// countries this feature exists to filter OUT. Only terms distinctive enough to reliably mean THIS
// country specifically are included. Populated for US only for now, since that's the confirmed,
// reported case — reads as "no signal" (same as today) for every other home country rather than
// guessing at another country's equivalent vocabulary.
const HOME_INSTITUTION_TERMS: Partial<Record<string, readonly string[]>> = {
  US: [
    'white house', 'capitol hill', 'gop',
    'senate', 'senator', 'senators',
    'congress', 'congressional',
    'house of representatives',
    'democrat', 'democrats', 'democratic party',
    'republican', 'republicans', 'republican party',
  ],
};

function hasHomeInstitutionSignal(title: string, snippet: string | null, homeCountryCode: string): boolean {
  const terms = HOME_INSTITUTION_TERMS[homeCountryCode.toUpperCase()];
  if (!terms) return false;
  // normalizeTitle (not a plain .toLowerCase()) matters here, not just for consistency with the rest
  // of this codebase's whole-word matching: it also collapses punctuation to spaces, and real
  // snippets constantly put a comma or period right after an institution name ("...the House of
  // Representatives, which reconvenes Monday..."). A raw-text space-padded match would miss that —
  // "representatives," has no trailing space for " house of representatives " to find — silently
  // undoing this fix for exactly the punctuation-heavy real text it's meant to handle, while every
  // clean, comma-free test case kept passing.
  const haystack = ` ${normalizeTitle(`${title} ${snippet ?? ''}`)} `;
  return terms.some((t) => haystack.includes(` ${t} `));
}

export function detectStoryCountry(
  title: string,
  snippet: string | null,
  homeCountryCode: string
): StoryPlace {
  const home = homeCountryCode.toUpperCase();
  const countryCodes = new Set<string>();

  for (const text of [title, snippet ?? '']) {
    for (const { phrase, wordCount } of capitalizedPhrases(text, MAX_NGRAM_WORDS)) {
      const directCc = lookupCountry(phrase);
      if (directCc) countryCodes.add(directCc);

      const cityRows = lookupCity(phrase);
      if (cityRows) for (const row of eligibleRows(cityRows, wordCount)) countryCodes.add(row.cc);

      const regionCcs = lookupRegion(phrase);
      if (regionCcs) for (const cc of regionCcs) countryCodes.add(cc);
    }
  }

  if (countryCodes.size === 0) return { kind: 'none' };
  if (countryCodes.has(home)) return { kind: 'home' };
  if (hasHomeInstitutionSignal(title, snippet, home)) return { kind: 'home' };
  // Multiple different foreign countries named in the same story is rare and low-stakes either way
  // (Set iteration order is insertion order, so this is simply "the first one the scan found") — the
  // only two things riding on the specific code are the subchannel match and which bucket a routed
  // story lands in, not a claim that it's the story's ONLY subject.
  return { kind: 'foreign', countryCode: [...countryCodes][0] };
}
