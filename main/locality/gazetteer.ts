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
  /** ISO 3166-1 alpha-2 country code of the matched city — the row already carries this (`.cc`), it
   * was just discarded before leaving this module until the foreign-country locality signal (see
   * relevance.ts / placeExtraction.ts's foreignPlaceSignal) needed a home country to compare against. */
  countryCode: string;
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
// doubles as the "is this token itself a country name" check in looksLikePlaceChannel below, AND
// (via lookupCountry in placeExtraction.ts's foreignPlaceSignal) as the article-text country-name
// scanner behind the foreign-country locality signal in relevance.ts — so this table's coverage
// directly determines which countries' stories that signal can even see.
//
// Deliberately curated, not a mechanical dump of every ISO country name: a handful of real
// countries share their name with a common English word or a US state, and including them would
// create real false positives given this is matched the same permissive way a city name is (a
// bare capitalized word/phrase, no other context) —
//   - Georgia: collides with the US state, which comes up constantly in US political coverage.
//   - Jordan / Chad: extremely common first names.
//   - Jersey: collides with both "New Jersey" and a sports jersey.
// left out on purpose. Two US territories are aliased to 'US' rather than their own GeoNames code
// (PR/GU) so a story about Puerto Rico or Guam doesn't read as "foreign" for a US-home user — they
// aren't foreign countries, unlike every other code in this table.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
  'puerto rico': 'US', guam: 'US',
  canada: 'CA', mexico: 'MX', uk: 'GB', 'united kingdom': 'GB', britain: 'GB',
  'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', ireland: 'IE',
  france: 'FR', germany: 'DE', italy: 'IT', spain: 'ES', portugal: 'PT', netherlands: 'NL',
  belgium: 'BE', switzerland: 'CH', austria: 'AT', sweden: 'SE', norway: 'NO', denmark: 'DK',
  finland: 'FI', iceland: 'IS', poland: 'PL', greece: 'GR', ukraine: 'UA', russia: 'RU',
  belarus: 'BY', moldova: 'MD', romania: 'RO', bulgaria: 'BG', hungary: 'HU',
  'czech republic': 'CZ', czechia: 'CZ', slovakia: 'SK', slovenia: 'SI', croatia: 'HR',
  serbia: 'RS', bosnia: 'BA', albania: 'AL', 'north macedonia': 'MK', kosovo: 'XK',
  lithuania: 'LT', latvia: 'LV', estonia: 'EE', luxembourg: 'LU', malta: 'MT', cyprus: 'CY',
  turkey: 'TR', israel: 'IL', palestine: 'PS', lebanon: 'LB', syria: 'SY', iraq: 'IQ',
  iran: 'IR', 'saudi arabia': 'SA', yemen: 'YE', oman: 'OM', qatar: 'QA', kuwait: 'KW',
  bahrain: 'BH', 'united arab emirates': 'AE', uae: 'AE', afghanistan: 'AF',
  egypt: 'EG', libya: 'LY', tunisia: 'TN', algeria: 'DZ', morocco: 'MA', sudan: 'SD',
  ethiopia: 'ET', somalia: 'SO', eritrea: 'ER', djibouti: 'DJ', kenya: 'KE', uganda: 'UG',
  tanzania: 'TZ', rwanda: 'RW', burundi: 'BI', 'south sudan': 'SS', 'south africa': 'ZA',
  namibia: 'NA', botswana: 'BW', zimbabwe: 'ZW', zambia: 'ZM', mozambique: 'MZ',
  malawi: 'MW', madagascar: 'MG', nigeria: 'NG', ghana: 'GH', senegal: 'SN', mali: 'ML',
  niger: 'NE', cameroon: 'CM', 'ivory coast': 'CI', "cote d'ivoire": 'CI', guinea: 'GN',
  benin: 'BJ', togo: 'TG', 'sierra leone': 'SL', liberia: 'LR', gabon: 'GA', congo: 'CG',
  'democratic republic of congo': 'CD', angola: 'AO', mauritania: 'MR',
  india: 'IN', pakistan: 'PK', bangladesh: 'BD', 'sri lanka': 'LK', nepal: 'NP',
  bhutan: 'BT', myanmar: 'MM', china: 'CN', japan: 'JP', 'south korea': 'KR',
  'north korea': 'KP', taiwan: 'TW', mongolia: 'MN', vietnam: 'VN', thailand: 'TH',
  philippines: 'PH', indonesia: 'ID', malaysia: 'MY', singapore: 'SG', cambodia: 'KH',
  laos: 'LA', kazakhstan: 'KZ', uzbekistan: 'UZ', turkmenistan: 'TM',
  tajikistan: 'TJ', kyrgyzstan: 'KG', azerbaijan: 'AZ', armenia: 'AM',
  australia: 'AU', 'new zealand': 'NZ', fiji: 'FJ', 'papua new guinea': 'PG',
  brazil: 'BR', argentina: 'AR', chile: 'CL', colombia: 'CO', venezuela: 'VE', peru: 'PE',
  ecuador: 'EC', bolivia: 'BO', paraguay: 'PY', uruguay: 'UY', guyana: 'GY', suriname: 'SR',
  panama: 'PA', 'costa rica': 'CR', nicaragua: 'NI', honduras: 'HN', 'el salvador': 'SV',
  guatemala: 'GT', belize: 'BZ', cuba: 'CU', 'dominican republic': 'DO', haiti: 'HT',
  jamaica: 'JM', 'trinidad and tobago': 'TT', bahamas: 'BS', barbados: 'BB',
};
// Canonical display name per country code, for the handful of countries this app actually talks
// about in prose (the AI classifier's foreign-politics guidance, see aiRelevance.ts) — deliberately
// NOT auto-derived from COUNTRY_ALIASES (whose keys are lowercase search aliases, sometimes
// abbreviations like "uae", not display-ready). Only needs entries for codes worth naming to a
// model; countryDisplayName returns null for anything else rather than guessing.
const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  US: 'the United States', CA: 'Canada', MX: 'Mexico', GB: 'the United Kingdom', IE: 'Ireland',
  FR: 'France', DE: 'Germany', IT: 'Italy', ES: 'Spain', PT: 'Portugal', NL: 'the Netherlands',
  BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', SE: 'Sweden', NO: 'Norway', DK: 'Denmark',
  FI: 'Finland', IS: 'Iceland', PL: 'Poland', GR: 'Greece', UA: 'Ukraine', RU: 'Russia',
  RO: 'Romania', HU: 'Hungary', CZ: 'the Czech Republic', TR: 'Turkey', IL: 'Israel',
  LB: 'Lebanon', SY: 'Syria', IQ: 'Iraq', IR: 'Iran', SA: 'Saudi Arabia', AE: 'the UAE',
  AF: 'Afghanistan', EG: 'Egypt', LY: 'Libya', MA: 'Morocco', SD: 'Sudan', ET: 'Ethiopia',
  KE: 'Kenya', NG: 'Nigeria', GH: 'Ghana', ZA: 'South Africa', ZW: 'Zimbabwe',
  IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal', MM: 'Myanmar',
  CN: 'China', JP: 'Japan', KR: 'South Korea', KP: 'North Korea', TW: 'Taiwan',
  VN: 'Vietnam', TH: 'Thailand', PH: 'the Philippines', ID: 'Indonesia', MY: 'Malaysia',
  SG: 'Singapore', AU: 'Australia', NZ: 'New Zealand', BR: 'Brazil', AR: 'Argentina',
  CL: 'Chile', CO: 'Colombia', VE: 'Venezuela', PE: 'Peru', CU: 'Cuba',
};

export type Continent = 'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania' | 'Antarctica';

// Region-level names people actually write in headlines. Deliberately excludes "the Middle East" —
// a genuinely common phrase, but it's a fuzzy, debated set of countries rather than a clean
// continent, and most Middle East coverage independently names a specific country anyway (which the
// country-tier check above already catches) — not worth the ambiguity for the residual cases where
// it doesn't. See placeExtraction.ts's foreignPlaceSignal for how this is actually used.
const CONTINENT_ALIASES: Record<string, Continent> = {
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  'north america': 'North America',
  'south america': 'South America',
  oceania: 'Oceania',
  antarctica: 'Antarctica',
};

// Which continent each ISO country code belongs to. Used ONLY to find the continent of the user's
// OWN home country (a single lookup, always the same code for a given user) — never to place an
// arbitrary detected country, so this doesn't need to be exhaustive. Covers the countries that
// realistically show up as someone's home location; a code missing here just means the
// continent-tier signal quietly stays inactive for that home location (see foreignPlaceSignal)
// rather than misfiring — same "false negative over false positive" bias as the rest of this file.
const CONTINENT_BY_CC: Record<string, Continent> = {
  US: 'North America', CA: 'North America', MX: 'North America', PA: 'North America',
  CR: 'North America', NI: 'North America', HN: 'North America', SV: 'North America',
  GT: 'North America', BZ: 'North America', CU: 'North America', DO: 'North America',
  HT: 'North America', JM: 'North America', TT: 'North America', BS: 'North America',
  BB: 'North America',
  BR: 'South America', AR: 'South America', CL: 'South America', CO: 'South America',
  VE: 'South America', PE: 'South America', EC: 'South America', BO: 'South America',
  PY: 'South America', UY: 'South America', GY: 'South America', SR: 'South America',
  GB: 'Europe', IE: 'Europe', FR: 'Europe', DE: 'Europe', IT: 'Europe', ES: 'Europe',
  PT: 'Europe', NL: 'Europe', BE: 'Europe', CH: 'Europe', AT: 'Europe', SE: 'Europe',
  NO: 'Europe', DK: 'Europe', FI: 'Europe', IS: 'Europe', PL: 'Europe', GR: 'Europe',
  UA: 'Europe', RU: 'Europe', BY: 'Europe', MD: 'Europe', RO: 'Europe', BG: 'Europe',
  HU: 'Europe', CZ: 'Europe', SK: 'Europe', SI: 'Europe', HR: 'Europe', RS: 'Europe',
  BA: 'Europe', AL: 'Europe', MK: 'Europe', XK: 'Europe', LT: 'Europe', LV: 'Europe',
  EE: 'Europe', LU: 'Europe', MT: 'Europe', CY: 'Europe', GE: 'Europe',
  TR: 'Asia', IL: 'Asia', PS: 'Asia', LB: 'Asia', SY: 'Asia', IQ: 'Asia', IR: 'Asia',
  SA: 'Asia', YE: 'Asia', OM: 'Asia', QA: 'Asia', KW: 'Asia', BH: 'Asia', AE: 'Asia',
  AF: 'Asia', IN: 'Asia', PK: 'Asia', BD: 'Asia', LK: 'Asia', NP: 'Asia', BT: 'Asia',
  MM: 'Asia', CN: 'Asia', JP: 'Asia', KR: 'Asia', KP: 'Asia', TW: 'Asia', MN: 'Asia',
  VN: 'Asia', TH: 'Asia', PH: 'Asia', ID: 'Asia', MY: 'Asia', SG: 'Asia', KH: 'Asia',
  LA: 'Asia', KZ: 'Asia', UZ: 'Asia', TM: 'Asia', TJ: 'Asia', KG: 'Asia', AZ: 'Asia',
  AM: 'Asia',
  EG: 'Africa', LY: 'Africa', TN: 'Africa', DZ: 'Africa', MA: 'Africa', SD: 'Africa',
  ET: 'Africa', SO: 'Africa', ER: 'Africa', DJ: 'Africa', KE: 'Africa', UG: 'Africa',
  TZ: 'Africa', RW: 'Africa', BI: 'Africa', SS: 'Africa', ZA: 'Africa', NA: 'Africa',
  BW: 'Africa', ZW: 'Africa', ZM: 'Africa', MZ: 'Africa', MW: 'Africa', MG: 'Africa',
  NG: 'Africa', GH: 'Africa', SN: 'Africa', ML: 'Africa', NE: 'Africa', CM: 'Africa',
  CI: 'Africa', GN: 'Africa', BJ: 'Africa', TG: 'Africa', SL: 'Africa', LR: 'Africa',
  GA: 'Africa', CG: 'Africa', CD: 'Africa', AO: 'Africa', MR: 'Africa',
  AU: 'Oceania', NZ: 'Oceania', FJ: 'Oceania', PG: 'Oceania',
};

/** Country code for `phrase`, via COUNTRY_ALIASES (full country/territory names, e.g. "India")
 * — deliberately NOT the bare-two-letter-code fallback isCountryCode uses for channel names below.
 * That fallback is safe for a short, deliberate channel name, but not for scanning ordinary sentence
 * text: several real ISO codes are also extremely common English words that are routinely
 * capitalized at the start of a sentence — "In" (IN, India), "It" (IT, Italy), "By" (BY, Belarus),
 * "So" (SO, Somalia) — which would misfire constantly if matched here.
 *
 * "US" is the one deliberate exception, and ONLY when BOTH letters are capitalized (not just the
 * first, which is how case is checked everywhere else in this module) — confirmed live as a real
 * false positive without this: a story headlined "US government map of Africa mislabels every
 * country..." named no place other than the abbreviation, so it read as foreign-continent coverage
 * with nothing to prove otherwise. ALL-CAPS is a much stronger signal than ordinary sentence-initial
 * capitalization (nobody writes "US weekly" the way they'd write "Us Weekly"). Not extended to the
 * rest of the code set — "UK" doesn't need its own case here, "uk" is already a safe plain
 * COUNTRY_ALIASES entry below (no common English word collides with it the way "us" does) — and "IT"
 * (Italy) very much WOULD collide even all-caps, as a Technology channel's own "IT department"/
 * "IT infrastructure" headlines would demonstrate, which is why this isn't "any code, if all-caps." */
export function lookupCountry(phrase: string): string | null {
  if (phrase === 'US') return 'US';
  return COUNTRY_ALIASES[phrase.trim().toLowerCase()] ?? null;
}

/** Continent for `phrase` (e.g. "Africa"), via CONTINENT_ALIASES. */
export function lookupContinent(phrase: string): Continent | null {
  return CONTINENT_ALIASES[phrase.trim().toLowerCase()] ?? null;
}

/** Continent of a country code, or null when the code isn't in CONTINENT_BY_CC's coverage. */
export function continentOfCountry(cc: string): Continent | null {
  return CONTINENT_BY_CC[cc.toUpperCase()] ?? null;
}

/** Canonical display name for a country code (e.g. "the United States"), for the AI classifier
 * prompt — null when the code isn't one of the countries worth naming to a model. */
export function countryDisplayName(cc: string): string | null {
  return COUNTRY_CODE_TO_NAME[cc.toUpperCase()] ?? null;
}

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

function resolveParts(cityPart: string, qualifier: string | null): ResolvedLocation | null {
  const candidates = BY_NAME.get(cityPart);
  if (!candidates || candidates.length === 0) return null;

  let pool = candidates;
  if (qualifier) {
    const filtered = candidates.filter((c) => qualifierMatches(c, qualifier));
    if (filtered.length > 0) pool = filtered;
  }

  const best = pool.reduce((a, b) => (b.pop > a.pop ? b : a));
  return { label: formatLabel(best), lat: best.lat, lon: best.lon, countryCode: best.cc };
}

/** Resolve a user-typed city string ("Los Angeles, CA" / "Banff, Alberta" / bare "Springfield")
 * against the bundled gazetteer. Called once, at settings-save time.
 *   - An optional qualifier after the last comma narrows by country code, common country name,
 *     admin1 (state/province) name, or a US/Canadian two-letter abbreviation.
 *   - When ambiguous (no qualifier, or the qualifier matches nothing), falls back to the
 *     highest-population candidate — a deliberate simplifying assumption for bare names like
 *     "Springfield"; the UI should encourage "City, State/Country" to avoid relying on it.
 *   - No comma at all ("Alameda ca", "Alameda CA") is a real, common way people actually type
 *     this despite the UI's own comma hint — confirmed live: it silently resolved to nothing,
 *     which (via a since-fixed bug in how the server treated a null resolve) got saved as a
 *     broken location with no lat/lon at all. Tried as a bare name first (so genuine multi-word
 *     names like "Mexico City" or "New York" still resolve as themselves); only if THAT fails is
 *     the last word retried as a qualifier, covering the comma-less "City State" phrasing.
 * Returns null on no match. Never throws. */
export function resolveCity(query: string): ResolvedLocation | null {
  if (!query || !query.trim()) return null;
  const commaIdx = query.indexOf(',');
  if (commaIdx !== -1) {
    return resolveParts(normalize(query.slice(0, commaIdx)), normalize(query.slice(commaIdx + 1)));
  }

  const direct = resolveParts(normalize(query), null);
  if (direct) return direct;

  const trimmed = query.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return null;
  return resolveParts(normalize(trimmed.slice(0, lastSpace)), normalize(trimmed.slice(lastSpace + 1)));
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
    if (COUNTRY_ALIASES[token] || isCountryCode(token) || CONTINENT_ALIASES[token]) return true;
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
