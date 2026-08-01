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

import { lookupCity, type CityRow } from './gazetteer';

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

/** Distance (km) from `home` to the nearest gazetteer place mentioned in `title`/`snippet`, or
 * null if no eligible mention was found. Scans 1-, 2-, and 3-word windows over both fields. */
export function nearestMentionKm(
  title: string,
  snippet: string | null,
  home: { lat: number; lon: number }
): number | null {
  let nearest: number | null = null;

  for (const text of [title, snippet ?? '']) {
    const words = wordTokens(text);
    for (let start = 0; start < words.length; start++) {
      if (!isCapitalized(words[start])) continue;
      for (let len = 1; len <= MAX_NGRAM_WORDS && start + len <= words.length; len++) {
        const phrase = words.slice(start, start + len).join(' ');
        const rows = lookupCity(phrase);
        if (!rows) continue;
        for (const row of eligibleRows(rows, len)) {
          const km = haversineKm(home.lat, home.lon, row.lat, row.lon);
          if (nearest === null || km < nearest) nearest = km;
        }
      }
    }
  }

  return nearest;
}
