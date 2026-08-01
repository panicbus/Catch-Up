/** Pure, Electron-agnostic place-name lookup — same portability contract as main/providers/ (see
 * that folder's types.ts): only plain JS/JSON, no Node/Electron APIs, so it lifts straight into a
 * future hosted backend.
 *
 * Bundled data: main/data/cities.json, a trimmed GeoNames "cities5000" extract (all populated
 * places with population > 5000, ~70k rows worldwide) plus admin1 (state/province) names, joined
 * and shrunk by scripts/build-gazetteer.mjs. CC BY 4.0 — see the attribution note in README.md.
 * cities5000 (not the smaller cities15000 cut) is deliberate: a lot of real local-news datelines
 * are small towns under 15,000 people (Banff, AB, pop. ~8,300, is the motivating example for this
 * whole feature and would be missing from a 15,000-floor cut). */

import cities from '../data/cities.json';

export interface CityRow {
  /** Name as GeoNames records it (may include diacritics). */
  n: string;
  /** ASCII transliteration — what gets shown in a resolved label. */
  a: string;
  lat: number;
  lon: number;
  /** ISO 3166-1 alpha-2 country code. */
  cc: string;
  /** Admin1 (state/province) name, or null when GeoNames has no admin1 record for this row. */
  adm1: string | null;
  pop: number;
}

export interface ResolvedLocation {
  label: string;
  lat: number;
  lon: number;
}

const CITIES = cities as CityRow[];

// Name -> every row sharing that name (lowercased key). Built once at module load. A name indexes
// under both its native form and its ASCII form (most rows share both already).
const BY_NAME = new Map<string, CityRow[]>();
function indexUnder(key: string, row: CityRow): void {
  const k = key.trim().toLowerCase();
  if (!k) return;
  const list = BY_NAME.get(k);
  if (list) list.push(row);
  else BY_NAME.set(k, [row]);
}
for (const row of CITIES) {
  indexUnder(row.n, row);
  if (row.a !== row.n) indexUnder(row.a, row);
}

/** Rows registered under `name` (case-insensitive), or undefined if nothing matches. Used by
 * placeExtraction.ts to look up candidate n-grams against the same index built here. */
export function lookupCity(name: string): CityRow[] | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Deliberately small, non-exhaustive alias tables for the qualifier a user types after a comma
// ("Los Angeles, CA" / "Los Angeles, California" / "Toronto, Canada"). A plain two-letter ISO
// country code (e.g. "US", "GB") always works via the direct cc match below regardless of these
// tables — these only add the common full-name/abbreviation spellings people actually type.
const US_STATES: Record<string, string> = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California', co: 'Colorado',
  ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia', hi: 'Hawaii', id: 'Idaho',
  il: 'Illinois', in: 'Indiana', ia: 'Iowa', ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana',
  me: 'Maine', md: 'Maryland', ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota',
  ms: 'Mississippi', mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire',
  nj: 'New Jersey', nm: 'New Mexico', ny: 'New York', nc: 'North Carolina', nd: 'North Dakota',
  oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon', pa: 'Pennsylvania', ri: 'Rhode Island',
  sc: 'South Carolina', sd: 'South Dakota', tn: 'Tennessee', tx: 'Texas', ut: 'Utah', vt: 'Vermont',
  va: 'Virginia', wa: 'Washington', wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming',
  dc: 'District of Columbia',
};
const CA_PROVINCES: Record<string, string> = {
  ab: 'Alberta', bc: 'British Columbia', mb: 'Manitoba', nb: 'New Brunswick',
  nl: 'Newfoundland and Labrador', ns: 'Nova Scotia', nt: 'Northwest Territories', nu: 'Nunavut',
  on: 'Ontario', pe: 'Prince Edward Island', qc: 'Quebec', sk: 'Saskatchewan', yt: 'Yukon',
};
// Full-word country names -> ISO code, for common countries in international news + the same list
// doubles as the "is this token itself a country name" check in looksLikePlaceChannel below.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
  canada: 'CA', mexico: 'MX', uk: 'GB', 'united kingdom': 'GB', england: 'GB', scotland: 'GB',
  wales: 'GB', ireland: 'IE', france: 'FR', germany: 'DE', italy: 'IT', spain: 'ES',
  portugal: 'PT', netherlands: 'NL', belgium: 'BE', switzerland: 'CH', austria: 'AT',
  sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', poland: 'PL', greece: 'GR',
  ukraine: 'UA', russia: 'RU', turkey: 'TR', israel: 'IL', egypt: 'EG', 'south africa': 'ZA',
  nigeria: 'NG', kenya: 'KE', india: 'IN', pakistan: 'PK', china: 'CN', japan: 'JP',
  'south korea': 'KR', 'north korea': 'KP', vietnam: 'VN', thailand: 'TH', philippines: 'PH',
  indonesia: 'ID', australia: 'AU', 'new zealand': 'NZ', brazil: 'BR', argentina: 'AR',
  chile: 'CL', colombia: 'CO', venezuela: 'VE', peru: 'PE',
};
const US_STATE_ABBR_BY_NAME = new Map(Object.entries(US_STATES).map(([abbr, name]) => [normalize(name), abbr.toUpperCase()]));
const CA_PROVINCE_ABBR_BY_NAME = new Map(Object.entries(CA_PROVINCES).map(([abbr, name]) => [normalize(name), abbr.toUpperCase()]));

function qualifierMatches(row: CityRow, qualifier: string): boolean {
  if (row.cc.toLowerCase() === qualifier) return true;
  const aliasedCc = COUNTRY_ALIASES[qualifier];
  if (aliasedCc && row.cc === aliasedCc) return true;
  if (!row.adm1) return false;
  const adm1Norm = normalize(row.adm1);
  if (adm1Norm === qualifier) return true;
  if (row.cc === 'US' && US_STATES[qualifier] && normalize(US_STATES[qualifier]) === adm1Norm) return true;
  if (row.cc === 'CA' && CA_PROVINCES[qualifier] && normalize(CA_PROVINCES[qualifier]) === adm1Norm) return true;
  return false;
}

function formatLabel(row: CityRow): string {
  const parts = [row.a];
  if (row.adm1) {
    const abbr = US_STATE_ABBR_BY_NAME.get(normalize(row.adm1)) ?? CA_PROVINCE_ABBR_BY_NAME.get(normalize(row.adm1));
    parts.push(abbr ?? row.adm1);
  }
  parts.push(row.cc);
  return parts.join(', ');
}

/** Resolve a user-typed city string ("Los Angeles, CA" / "Banff, Alberta" / bare "Springfield")
 * against the bundled gazetteer. Called once, at settings-save time.
 *   - An optional qualifier after the last comma narrows by country code, common country name,
 *     admin1 (state/province) name, or a US/Canadian two-letter abbreviation.
 *   - When ambiguous (no qualifier, or the qualifier matches nothing), falls back to the
 *     highest-population candidate — a deliberate simplifying assumption for bare names like
 *     "Springfield"; the UI should encourage "City, State/Country" to avoid relying on it.
 * Returns null on no match. Never throws. */
export function resolveCity(query: string): ResolvedLocation | null {
  if (!query || !query.trim()) return null;
  const commaIdx = query.indexOf(',');
  const cityPart = normalize(commaIdx === -1 ? query : query.slice(0, commaIdx));
  const qualifier = commaIdx === -1 ? null : normalize(query.slice(commaIdx + 1));

  const candidates = BY_NAME.get(cityPart);
  if (!candidates || candidates.length === 0) return null;

  let pool = candidates;
  if (qualifier) {
    const filtered = candidates.filter((c) => qualifierMatches(c, qualifier));
    if (filtered.length > 0) pool = filtered;
  }

  const best = pool.reduce((a, b) => (b.pop > a.pop ? b : a));
  return { label: formatLabel(best), lat: best.lat, lon: best.lon };
}

// A topic/entity channel named after a real place (e.g. "Ukraine", "Paris Olympics") would have
// every legitimate story about it penalized by a naive distance check — this guard suppresses the
// locality signal for those channels. Tokenized (not a single exact-string check) so a multi-word
// channel name like "Paris Olympics" is still caught via its "Paris" token.
const PLACE_CHANNEL_MIN_POP = 50_000;
function tokens(name: string): string[] {
  return normalize(name).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Does this channel name look like it's itself about a place (a city or country)? Used to keep
 * the locality signal from penalizing every story in a channel that IS a place. */
export function looksLikePlaceChannel(channelName: string): boolean {
  for (const token of tokens(channelName)) {
    if (COUNTRY_ALIASES[token] || isCountryCode(token)) return true;
    const rows = BY_NAME.get(token);
    if (rows && rows.some((r) => r.pop >= PLACE_CHANNEL_MIN_POP)) return true;
  }
  return false;
}

// A bare two-letter token that is itself a country code in the dataset (e.g. a channel literally
// named "US" or "UK" is astronomically unlikely, but this keeps the check consistent/cheap).
const COUNTRY_CODES = new Set(CITIES.map((r) => r.cc.toLowerCase()));
function isCountryCode(token: string): boolean {
  return token.length === 2 && COUNTRY_CODES.has(token);
}
