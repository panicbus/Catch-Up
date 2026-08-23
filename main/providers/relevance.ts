/** Pure, Electron-agnostic relevance gate — same portability contract as the rest of this folder
 * (see types.ts): only plain JS, no Node/Electron APIs, so it lifts straight into a future hosted
 * backend. Reused by refreshAgent (via aiRelevance) between fetching and saving.
 *
 * THE PROBLEM: a channel is populated by sending its name verbatim as a keyword search to every
 * provider, and off-topic stories come back — politics in a Music channel, a "10 Movies…" listicle in
 * Politics, a crime story that merely says "Tech". We can only see an article's title + snippet +
 * source + section here, so this is a foundational (no-AI) gate; the LLM layer (aiRelevance.ts +
 * classifier.ts) composes on top of it for the semantic calls keywords can't make.
 *
 * HOW IT WORKS — a soft, additive signal score (not hard binary rules), plus a two-tier keep rule:
 *   - Signals: on-topic evidence adds (a channel's disambiguating keyword, a matching provider
 *     section, a specific/subchannel term), off-topic evidence subtracts (an anti-topic keyword, a
 *     section that belongs to a DIFFERENT category). They sum to a score, so one strong negative drops
 *     a story but a strong positive can rescue one that also trips a negative (a real politics story
 *     that happens to mention a film).
 *   - MAIN channels are LENIENT: keep unless the score goes net-negative (a clear off-topic signal).
 *     No positive is required — this preserves primary-source stories that never repeat the channel
 *     word (a real music story rarely says "music"). The exception is any LOOSE source — the Google
 *     News RSS fallback, and a user's own added custom sources (see customSourcePrefix below) — which
 *     must still show SOME positive evidence. Both share the same root problem: neither one's results
 *     are narrowed by the channel's own topic search the way every other provider's are, so nothing
 *     upstream of this gate has already done any relevance work on their behalf.
 *   - SUBCHANNELS are STRICT: the specific subchannel/entity term must appear, plus the same
 *     negative-signal drops. Subchannels are precise, so "when in doubt, keep out" applies there.
 *
 * The ambiguous category word itself ("tech", "music") is NEVER scored as positive evidence for a
 * category channel — that's what let "Virginia Tech" through. It classifies the channel (a trigger in
 * channelProfiles.ts) but an article has to earn relevance on the disambiguating keywords/section. */

import { normalizeTitle, normalizeUrl } from './dedupe';
import { sectionMatchesCategory, sectionIsForeign } from './channelProfiles';
import { looksLikePlaceChannel, subchannelCountryCode } from '../locality/gazetteer';
import { nearestMentionKm, foreignPlaceSignal, detectStoryCountry } from '../locality/placeExtraction';
import type { ChannelProfile, NewsCategory } from './channelProfiles';
import type { FetchedArticle } from './types';

// The loose, last-resort fallback provider (see registry.ts). Held to extra strictness below.
const FALLBACK_PROVIDER_ID = 'googlenewsrss';
// A user's own added source (server/customSources/) is tagged `custom:<sourceId>` — every one of
// them is loose in exactly the same sense as the Google News fallback (see isLooseProvider below):
// its results are a site's own general feed, never narrowed by a per-channel topic search, so it
// gets the same extra-strictness treatment regardless of which specific source it is.
const CUSTOM_PROVIDER_PREFIX = 'custom:';

/** A provider whose results were never narrowed by the channel's own topic search, and so need to
 * show real positive evidence of being on-topic rather than just "not clearly off-topic" — see the
 * file-level comment above and this function's one call site in keepArticle. */
function isLooseProvider(provider: string): boolean {
  return provider === FALLBACK_PROVIDER_ID || provider.startsWith(CUSTOM_PROVIDER_PREFIX);
}

/** The article's own hostname, computed from its URL the same way merge() derives sourceDomain for
 * storage (see server/stores/articlesCache.ts) — not read off a pre-computed field, because at
 * filtering time (before merge) no such field exists yet. null on a malformed URL, same defensive
 * fallback merge() itself uses. */
function articleHostname(url: string): string | null {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Does the article's own hostname match one of the user's trusted domains — exact, or a
 * subdomain of one (trusting "nytimes.com" should also cover "cooking.nytimes.com"). Both sides
 * are compared with any leading "www." stripped so a user pasting "www.reuters.com" still matches
 * a bare "reuters.com" article host and vice versa. */
function isTrustedSource(url: string, trustedDomains: readonly string[]): boolean {
  if (trustedDomains.length === 0) return false;
  const host = articleHostname(url);
  if (!host) return false;
  return trustedDomains.some((raw) => {
    const domain = raw.trim().toLowerCase().replace(/^www\./, '');
    return domain.length > 0 && (host === domain || host.endsWith(`.${domain}`));
  });
}

// Tiny stopword set so a multi-word topic ("The Pool", "de France") isn't matched on filler words.
// Deliberately minimal — we only want to avoid matching on words that carry no topic meaning.
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'de', 'la']);

// Additive signal weights (positive = on-topic, negative = off-topic) and the keep threshold. Tuned
// so any single clear negative (an anti-topic keyword, or a foreign provider section) pushes a story
// below the bar on its own, while a matching section + on-topic keyword can rescue a story that also
// trips one negative. All here at the top for easy tuning.
const W = {
  termTitle: 3, // a specific/subchannel term in the title
  termTag: 3, // ...in a provider topic tag (the source's own label — as trustworthy as the title)
  termSnippet: 2, // ...in the snippet
  includeTitle: 2, // a category's disambiguating keyword (album, chip, senate) in the title
  includeTag: 2, // ...in a provider topic tag
  includeSnippet: 1, // ...in the snippet
  sectionMatch: 3, // provider section matches the channel's category
  urlPathMatch: 2, // a clean URL path segment matches the category (weaker than a real section field)
  excludeHit: -4, // an anti-topic keyword — a clear negative
  foreignSection: -4, // section belongs to a DIFFERENT category — a clear negative
  urlPathForeign: -2, // URL path belongs to a different category — a weaker negative
  // The channel's own name used in a completely different sense (see TOPIC_WRONG_SENSE in
  // channelProfiles.ts — "a phish" the attack vs. Phish the band). Sized to beat a topic channel's
  // OWN maximum positive: such a channel scores its name twice over (termTitle 3 + includeTitle 2
  // = 5, since include IS the name for topic channels), so anything weaker than -6 leaves a
  // wrong-sense story net-positive and it survives. Verified, not assumed.
  wrongSenseHit: -6,
  // Applies whenever a home location is configured, for topic/entity channels AND a handful of
  // category channels (see GateContext.locality / buildGateContext's localityEligible) — a nearby
  // mentioned CITY is a mild positive, a distant one a clear negative. For a topic channel's own
  // main feed the channel's term is scored twice over (once as a specificTerm, once as
  // profile.include — same word, both paths), so the weakest kept case (the term named ONLY in the
  // snippet) actually floors at +3 (termSnippet 2 + includeSnippet 1), not +2 — verified
  // empirically, not assumed. -4 tips that floor below KEEP_SCORE when the story's nearest
  // mentioned place is far away, while a title or tag match (floors at +5) survives regardless of
  // distance — strong on-topic evidence should never be overridden by geography alone. The lenient
  // category channels' floor is lower still (a single include-keyword hit, +1 to +2, or even a bare
  // 0 with no signal at all), so this is where the penalty does its real work: dropping the weak-
  // evidence hyperlocal-foreign long tail (a specific country's local politician, a district-level
  // story) while a well-covered story — matched by a real section field or a strong keyword hit —
  // keeps enough score to survive.
  localityNear: 1,
  localityFar: -4,
  // A COUNTRY or CONTINENT named in the story (as opposed to a city — see foreignCountry/
  // foreignContinent's one call site in scoreArticle) is much stronger, more confident evidence
  // that the whole story is fundamentally about somewhere else, not just a passing place mention —
  // real user reports were routine foreign-country political/business/etc. coverage that never
  // named a single city at all ("India announces new trade policy"), so nearestMentionKm's city-only
  // check had literally nothing to penalize. Sized against the actual scoring ceilings, not guessed:
  // a bare category main feed tops out at +5 (sectionMatch 3 + includeTitle 2 — a category's own
  // ambiguous word is never scorable, so that's the real ceiling there), so -7 reliably sinks it
  // (5-7 = -2). A SUBCHANNEL under one of these categories can reach +8 (its own term double-counts:
  // once via specificTerms' termTitle +3, again via gate.include still containing that same word
  // from CATEGORY_RULES +2, plus sectionMatch +3) — 8-7 = 1 still survives, which is the "truly
  // exceptional, heavily-signaled story" the strong-but-not-absolute design calls for, not a
  // loophole. foreignContinent is deliberately weaker: a continent is 50+ countries, much less
  // specific evidence than a named country, so a moderately-evidenced story (5-5 = 0) still survives
  // it while the near-zero-evidence floor still doesn't. ONLY applied on category channels (see
  // scoreArticle) — a topic/entity channel uses localityFar's gentler weight instead, so a channel
  // ABOUT a foreign person/place/thing can't have its own core content wiped out by the very
  // geography it's about.
  foreignCountry: -7,
  foreignContinent: -5,
  // A mild, not decisive, nudge for a source the user has explicitly marked trusted (see
  // TrustedSourcesSetting) — sized like includeTitle, strong enough to matter for ranking and to
  // occasionally tip a thin borderline case, but well short of any single clear negative above
  // (excludeHit/foreignSection at -4), so a trusted outlet's off-topic story still doesn't survive
  // just for being trusted.
  trustedSource: 2,
};
const KEEP_SCORE = 0; // keep when the summed score is >= this (i.e. not net-negative)
// TUNABLE: distance bands (km) for the locality signal above. Inside NEAR, a mild boost; beyond
// FAR, a mild penalty; the middle band is deliberately neutral (no cliff at one arbitrary radius).
const LOCALITY_NEAR_KM = 100;
const LOCALITY_FAR_KM = 500;

export interface QueryTerms {
  /** Meaningful, de-duplicated topic tokens (lowercased, stopwords removed). */
  terms: string[];
}

/** Everything the gate needs about the batch's channel/subchannel. `profile` is derived once upstream
 * (channelProfile) and threaded through so it isn't recomputed per article. */
export interface RelevanceContext {
  /** The exact provider search string (channel name, or `Channel "Subchannel"`). */
  topic: string;
  channelName: string;
  /** null for a channel-level (main) batch. */
  subchannelName: string | null;
  profile: ChannelProfile;
  /** The user's configured home city (Settings), or null when unset. `countryCode` is optional
   * purely for backward compatibility with a settings file saved before it existed (see
   * ipc-contract.ts's AppSettings.homeLocation) — a real, current save always has it. Only ever
   * applied to topic/entity channels and a handful of category channels — see buildGateContext. */
  homeLocation: { lat: number; lon: number; countryCode?: string } | null;
  /** Publisher domains the user has explicitly marked trusted (Settings.trustedSourceDomains) —
   * applies uniformly everywhere, unlike homeLocation/locality which are gated per channel type,
   * since "I trust this outlet" carries no category-specific caveat the way "close to home" does.
   * Optional (unlike homeLocation) purely so the many existing test call sites that build a
   * RelevanceContext by hand don't all need updating for a signal they aren't exercising —
   * buildGateContext treats undefined the same as an empty array. */
  trustedSourceDomains?: readonly string[];
  /** Every subchannel configured on this channel (not just the current batch's own subchannelName,
   * which is a single name or null) — used only by the Politics hard exclude below, to tell whether a
   * detected foreign country has a matching subchannel ("India", "Nigeria") it should be exempted for
   * rather than dropped. Exempting here only affects the keep/reject verdict — actually MOVING an
   * exempted article out of the main feed and into that subchannel is routeByCountry's job
   * (main/locality/politicsGeoRouting.ts), called separately from runChannel after this gate runs.
   * Optional for the same reason trustedSourceDomains is: existing test call sites that don't
   * exercise this signal don't need updating. */
  siblingSubchannelNames?: readonly string[];
}

/** Tokenize a provider search topic into scorable terms. `normalizeTitle` already lowercases and
 * turns punctuation (including the quotes asSearchPhrase adds) into spaces, so `"Phish Setlists"`
 * and `Music "Phish Setlists"` both reduce cleanly to word tokens. */
export function buildQueryTerms(topic: string): QueryTerms {
  const tokens = normalizeTitle(topic).split(' ').filter(Boolean);
  const terms = [...new Set(tokens.filter((t) => !STOPWORDS.has(t)))];
  return { terms };
}

// Whole-word match (padded spaces) so "art" doesn't match inside "startup" and "ai" doesn't match
// inside "again". Multi-word entries ("box office", "virginia tech") work too, since normalizeTitle
// space-separates every token. This is the matcher for terms, includes, and excludes alike.
function hasWord(haystack: string, term: string): boolean {
  return ` ${haystack} `.includes(` ${term} `);
}

function hasAnyWord(haystack: string, terms: string[]): boolean {
  return terms.some((t) => hasWord(haystack, t));
}

/** Does `term` appear as a whole word with a CAPITAL first letter anywhere in the raw (un-lowercased)
 * text? Used only for the curated ambiguous topic channels (see TOPIC_WRONG_SENSE): those names are
 * proper nouns, so real coverage always capitalizes them ("Phish announce a tour") while the other
 * sense usually doesn't ("how to spot a phish"). Deliberately returns true if ANY occurrence is
 * capitalized — a Title Case headline capitalizes everything, which makes this signal miss rather
 * than misfire, exactly the direction we want. */
function appearsCapitalized(raw: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const match of raw.matchAll(new RegExp(`\\b${escaped}\\b`, 'gi'))) {
    if (/^[A-Z]/.test(match[0])) return true;
  }
  return false;
}

/** Category signal from a URL path, used only when the provider gave us no section field. Considers
 * only clean single-word, all-alpha path segments (`/politics/`, `/technology/`, `/arts/music/`) so
 * date parts (2024, 05) and multi-word slugs ("the-politics-of-fashion") can't produce false signals. */
function urlCategorySignal(url: string, category: NewsCategory): 'match' | 'foreign' | null {
  let segments: string[];
  try {
    segments = new URL(url).pathname
      .toLowerCase()
      .split('/')
      .filter((s) => /^[a-z]+$/.test(s));
  } catch {
    return null;
  }
  for (const seg of segments) if (sectionMatchesCategory(seg, category)) return 'match';
  for (const seg of segments) if (sectionIsForeign(seg, category)) return 'foreign';
  return null;
}

interface ScoredSignals {
  score: number;
  /** EVERY specific term appeared (somewhere across title/tag/snippet, not necessarily together) —
   * the gate for strict subchannel/topic keeps. Deliberately ALL, not ANY: a multi-word entity name
   * like "Spider-Man" tokenizes to ["spider","man"], and requiring only one of those let a story
   * merely starting with "Man ..." match on the bare word "man" alone — confirmed live as a real
   * false positive once a source had no topic search narrowing its results to begin with. Genuine
   * coverage of a multi-word entity names the whole thing, so this costs nothing there. */
  hasSpecificTerm: boolean;
  /** AT LEAST ONE specific term appeared (not necessarily all) — narrower than hasPositive (which
   * also counts include-keyword/section evidence), used to detect the "some but not all words of a
   * multi-word entity" borderline case for AI rescue — see judgeArticle. */
  hasAnySpecificTerm: boolean;
  /** ANY on-topic evidence appeared — the gate for keeping a loose RSS-fallback result. */
  hasPositive: boolean;
  /** How many DISTINCT category include-keywords were found — not just "at least one." Used to
   * require multiple independent topical words from a loose source (see isLooseProvider's extra
   * gate below): a single generic word match (e.g. "teams" in "street crisis teams") is cheap and
   * common outside its category entirely, while genuine coverage routinely uses more than one
   * on-topic word (confirmed live: "...politicians' campaign finance loophole" hits both
   * "politicians" AND "campaign"). */
  includeHitCount: number;
  /** A real section-field match specifically — not the weaker URL-path guess, and not an include
   * keyword — the publisher's own structured categorization, trustworthy enough on its own even for
   * a loose source with no topic search behind it. */
  hasSectionMatch: boolean;
}

interface GateContext {
  /** Terms that must appear for a strict batch and score as strong positives (the ambiguous channel
   * name is removed for category channels, so it never counts). */
  specificTerms: string[];
  include: string[];
  exclude: string[];
  /** Keywords meaning the channel's own name is being used in a different sense entirely. */
  wrongSense: string[];
  category: NewsCategory | null;
  /** When true, a story must NAME a specific term to be kept (the strict tier). True for every
   * subchannel, AND for a topic/entity channel's own main feed — a specific entity (a band, a person)
   * should be named in a genuine story about it, unlike a broad category word ("music") a real story
   * rarely repeats. Only a CATEGORY channel's main feed is lenient (this stays false there). */
  requireSpecificTerm: boolean;
  /** The user's home location, but only when the locality signal should actually apply: a topic/
   * entity or locality-eligible category channel, a home location configured, AND the channel isn't
   * itself a place (see looksLikePlaceChannel) — every legitimate story in a channel named "Ukraine"
   * would otherwise get penalized purely for being far from home. null means the signal is inactive. */
  locality: { lat: number; lon: number; countryCode?: string } | null;
  /** See RelevanceContext.trustedSourceDomains — carried through unchanged, not gated by channel
   * type the way locality is. */
  trustedSourceDomains: readonly string[];
  /** Country codes the Politics hard exclude (see judgeArticle) should NOT reject, because a sibling
   * subchannel names that country. Always null outside a Politics category channel — computing this
   * for every category would be wasted work for a set nothing else ever reads. */
  politicsExemptCountryCodes: ReadonlySet<string> | null;
}

// Category channels where routine coverage of another country's own domestic affairs is exactly
// the same "not relevant to a reader who isn't there" shape as foreign domestic politics — the
// original, narrower problem this signal was built for. Explicitly NOT world/sports/entertainment:
// international coverage is the entire point of a World channel, and a foreign team/event/release
// is often exactly what a Sports or Entertainment channel is expected to surface.
const LOCALITY_CATEGORIES: ReadonlySet<NewsCategory> = new Set([
  'politics',
  'business',
  'health',
  'science',
  'technology',
]);

function buildGateContext(ctx: RelevanceContext): GateContext {
  const allTerms = buildQueryTerms(ctx.topic).terms;
  // For a category channel the channel-name word(s) are ambiguous (they're why it's a category), so
  // strip them from the scorable terms; whatever remains is subchannel/entity-specific. For a topic
  // channel every term is specific.
  const ambiguous =
    ctx.profile.type === 'category' ? new Set(buildQueryTerms(ctx.channelName).terms) : new Set<string>();
  const specificTerms = allTerms.filter((t) => !ambiguous.has(t));
  // Locality used to be topic/entity channels only, then broadened to the POLITICS category channel
  // too (not just a "Wildfires"-style topic) after real, repeated user reports of hyperlocal foreign
  // political stories (a district-level story about a politician in India, then "other places" too)
  // drowning out a broad Politics channel that had no other way to gauge global interest.
  // Broadened again to Business/Health/Science/Technology for the same underlying reason: routine
  // day-to-day coverage of another country's own domestic business, health, science, or tech affairs
  // is the same "not relevant to a reader who isn't there" shape as foreign domestic politics — see
  // LOCALITY_CATEGORIES above. Deliberately NOT every category: 'world' has an empty CATEGORY_RULES
  // include list (see channelProfiles.ts — "world channels are broad and stay lenient" is the whole
  // point of that category), so a World-channel story with no section tag would have had ZERO way to
  // earn the score back and got dropped purely for being far away — exactly backwards for a channel
  // whose entire purpose is far-away news (caught in review, not live — see the reverted broader
  // version's test coverage gap). Sports and Entertainment stay excluded too: a foreign team/event/
  // release is often exactly what those channels are expected to surface, not "uninteresting."
  // Bug fix, found while adding the Politics hard exclude below: this only ever checked the PARENT
  // channel's name, never the current batch's OWN subchannel name — so a "Politics · India"
  // subchannel's own dedicated fetch was already being penalized by the locality signal for being
  // about India, before this feature existed. A subchannel named after the very place it's about
  // needs the same exemption a place-named channel gets, or it can never actually serve as an escape
  // valve from its parent's locality scoring (or, after this change, its parent's hard exclude).
  const localityEligible =
    ctx.homeLocation != null &&
    !looksLikePlaceChannel(ctx.channelName) &&
    !(ctx.subchannelName != null && looksLikePlaceChannel(ctx.subchannelName)) &&
    (ctx.profile.type === 'topic' || (ctx.profile.category != null && LOCALITY_CATEGORIES.has(ctx.profile.category)));
  const politicsExemptCountryCodes =
    ctx.profile.category === 'politics' && ctx.siblingSubchannelNames?.length
      ? new Set(
          ctx.siblingSubchannelNames
            .map((name) => subchannelCountryCode(name))
            .filter((cc): cc is string => cc != null)
        )
      : null;
  return {
    specificTerms,
    include: ctx.profile.include,
    exclude: ctx.profile.exclude,
    wrongSense: ctx.profile.wrongSense,
    category: ctx.profile.category,
    requireSpecificTerm: ctx.subchannelName != null || ctx.profile.type === 'topic',
    locality: localityEligible ? ctx.homeLocation : null,
    trustedSourceDomains: ctx.trustedSourceDomains ?? [],
    politicsExemptCountryCodes,
  };
}

function scoreArticle(article: FetchedArticle, gate: GateContext): ScoredSignals {
  const title = normalizeTitle(article.title);
  const snippet = article.snippet ? normalizeTitle(article.snippet) : '';
  // The source's own topic tags (Guardian/NYT/NewsData), joined into one searchable string. A clean,
  // curated signal — a story tagged "Taylor Swift"/"Music" is on-topic even when the headline hides it.
  const tags = article.tags && article.tags.length ? normalizeTitle(article.tags.join(' ')) : '';
  let score = 0;
  let hasPositive = false;

  // Specific terms (the entity, or the subchannel's narrowing words) — each term scores once, best
  // source wins, but hasSpecificTerm itself requires ALL of them found somewhere (not just one) —
  // see ScoredSignals' own doc comment for why.
  let allSpecificTermsFound = true;
  let anySpecificTermFound = false;
  for (const t of gate.specificTerms) {
    let found = false;
    if (hasWord(title, t)) {
      score += W.termTitle;
      found = true;
    } else if (hasWord(tags, t)) {
      score += W.termTag;
      found = true;
    } else if (hasWord(snippet, t)) {
      score += W.termSnippet;
      found = true;
    }
    if (found) {
      hasPositive = true;
      anySpecificTermFound = true;
    } else {
      allSpecificTermsFound = false;
    }
  }
  const hasSpecificTerm = gate.specificTerms.length > 0 && allSpecificTermsFound;
  const hasAnySpecificTerm = gate.specificTerms.length > 0 && anySpecificTermFound;

  // Category disambiguating keywords — count once, best source wins (title > tag > snippet), same
  // as before, PLUS a distinct count (see includeHitCount's own doc comment) that doesn't collapse
  // once the first hit is found — every distinct word in gate.include that appears anywhere counts.
  if (hasAnyWord(title, gate.include)) {
    score += W.includeTitle;
    hasPositive = true;
  } else if (hasAnyWord(tags, gate.include)) {
    score += W.includeTag;
    hasPositive = true;
  } else if (hasAnyWord(snippet, gate.include)) {
    score += W.includeSnippet;
    hasPositive = true;
  }
  const includeHitCount = gate.include.filter(
    (t) => hasWord(title, t) || hasWord(tags, t) || hasWord(snippet, t)
  ).length;

  // Anti-topic keywords — a clear negative, in the title, a tag, or the snippet.
  if (hasAnyWord(title, gate.exclude) || hasAnyWord(tags, gate.exclude) || hasAnyWord(snippet, gate.exclude)) {
    score += W.excludeHit;
  }

  // The channel's name used in a wholly different sense (a "phish" the attack, in a channel about
  // Phish the band). Separate from exclude above because it must outweigh the channel's own name
  // scoring twice — see W.wrongSenseHit.
  if (gate.wrongSense.length > 0) {
    if (
      hasAnyWord(title, gate.wrongSense) ||
      hasAnyWord(tags, gate.wrongSense) ||
      hasAnyWord(snippet, gate.wrongSense)
    ) {
      score += W.wrongSenseHit;
    } else if (hasSpecificTerm) {
      // No wrong-sense vocabulary, but the name never appears capitalized in the real text — for a
      // proper-noun channel that alone is the wrong sense ("how to spot a phish before you click").
      // Tags are excluded from this check: providers often lowercase their own labels, which would
      // make a perfectly good story look lowercase-only.
      const raw = `${article.title} ${article.snippet ?? ''}`;
      if (!gate.specificTerms.some((t) => appearsCapitalized(raw, t))) score += W.wrongSenseHit;
    }
  }

  // Section evidence (category channels only). Prefer the provider's real section field; only if it's
  // absent do we fall back to a URL-path hint.
  let hasSectionMatch = false;
  if (gate.category) {
    if (article.section) {
      if (sectionMatchesCategory(article.section, gate.category)) {
        score += W.sectionMatch;
        hasPositive = true;
        hasSectionMatch = true;
      } else if (sectionIsForeign(article.section, gate.category)) {
        score += W.foreignSection;
      }
    } else {
      const sig = urlCategorySignal(article.url, gate.category);
      if (sig === 'match') {
        score += W.urlPathMatch;
        hasPositive = true;
      } else if (sig === 'foreign') {
        score += W.urlPathForeign;
      }
    }
  }

  // Locality (topic/entity channels with a home location only — see buildGateContext). A story
  // mentioning no resolvable place is left untouched; only a clear near/far mention nudges the score.
  // KNOWN NUANCE (verified in relevance.test.ts, not a bug): the "title/tag evidence always
  // survives distance" guarantee only fully holds for a channel's OWN term, because gate.include
  // is always the parent channel's word(s) (never the subchannel's). A SUBCHANNEL's own term named
  // only in the title (without the parent channel's word also present) floors at +3, same as a
  // channel-word-only-in-snippet match, so it CAN still be tipped out by localityFar. This is
  // acceptable, not accidental: subchannels are already the strict tier elsewhere in this file
  // ("when in doubt, keep out"), so a subchannel story with no other corroborating evidence being
  // more sensitive to a distant, unrelated place mention is consistent with that existing bar.
  //
  // Politics: the city-distance and country tiers below are now judgeArticle's hard exclude's job
  // entirely, and are skipped here — neither nearestMentionKm nor foreignPlaceSignal know about the
  // hard exclude's subchannel exemption, so leaving them active would silently re-penalize (even
  // reject, via score) a story judgeArticle specifically decided to let through. Confirmed live: a
  // "kept" verdict for an exempted India story turned back into a net-negative reject once this
  // block ran its own, unrelated -7 anyway, before this exclusion was added.
  //
  // The CONTINENT tier is the one part of this block Politics keeps. detectStoryCountry (the hard
  // exclude's detector) deliberately never resolves a bare continent mention with no specific
  // country — see its own comment — so the hard exclude never had an opinion on one to begin with,
  // and there's no exemption state to leak. A bare "unrest spreads across Africa"-style story for a
  // Politics channel keeps getting exactly the same soft, survivable -5 every other locality
  // category still gets for one.
  const isPolitics = gate.category === 'politics';
  if (gate.locality) {
    const km = isPolitics ? null : nearestMentionKm(article.title, article.snippet, gate.locality);
    if (km !== null) {
      if (km <= LOCALITY_NEAR_KM) score += W.localityNear;
      else if (km >= LOCALITY_FAR_KM) score += W.localityFar;
    } else if (gate.locality.countryCode) {
      // No CITY mentioned at all — the gap this signal actually exists for (see W.foreignCountry's
      // own comment): routine foreign coverage very often names the country or a person, never a
      // city ("India announces new trade policy"), so nearestMentionKm above had nothing to find.
      // Category channels (Politics/Business/Health/Science/Technology) get the strong weight this
      // was built for; a topic/entity channel gets localityFar's gentler one instead — a channel
      // ABOUT a foreign person/place/thing must not have its own core content wiped out by the very
      // geography it's about (see W.foreignCountry's comment for the concrete regression this avoids).
      const signal = foreignPlaceSignal(article.title, article.snippet, gate.locality.countryCode);
      if (!isPolitics && signal === 'country') score += gate.category ? W.foreignCountry : W.localityFar;
      else if (signal === 'continent') score += gate.category ? W.foreignContinent : W.localityFar;
    }
  }

  // Trusted source (see TrustedSourcesSetting) — unconditional, unlike locality, since there's no
  // channel-type carve-out where "I trust this outlet" wouldn't apply.
  if (isTrustedSource(article.url, gate.trustedSourceDomains)) score += W.trustedSource;

  return { score, hasSpecificTerm, hasAnySpecificTerm, hasPositive, includeHitCount, hasSectionMatch };
}

type Verdict = 'keep' | 'reject' | 'borderline';

interface Judgment {
  verdict: Verdict;
  /** scoreArticle's raw additive score — exposed alongside the verdict (not just the threshold
   * decision) so callers can persist it as a relevance/ranking signal for articles that survive.
   * Still fundamentally a keep/reject score, not a graded quality score: its weights were tuned so
   * one clear negative reliably sinks a story, not so distance above zero forms a smooth "how good"
   * scale. But the positive weights already DO form a coherent rough ordering among kept articles —
   * a title match plus a section match outscores a single weak snippet hit — which is what makes it
   * usable for ranking without a separate scoring pass. */
  score: number;
}

/** Three-way, not a boolean keep/reject — 'borderline' is a NEW category: a story the strict
 * keyword rules reject, but only for a reason that's about PRECISION of matching, not genuine
 * lack of evidence (a real exclude-keyword hit, a foreign section, or literally zero on-topic
 * signal still reject outright as 'reject', never 'borderline'). aiRelevance.ts gives 'borderline'
 * stories a second, semantic look from the AI classifier when one is configured — genuine coverage
 * that just uses a short form ("Giants win 5-2" for a "San Francisco Giants" channel, missing two
 * of its three words) or a real topical connection a single generic keyword can't prove on its own
 * gets a chance to be rescued there, while a user with no AI configured simply keeps the strict
 * result, same as before. See judgeArticle's two 'borderline' branches for exactly which cases
 * qualify. */
function judgeArticle(article: FetchedArticle, gate: GateContext): Judgment {
  // Politics hard exclude: every other locality-eligible category still uses the soft, additive
  // W.foreignCountry/-Continent penalty above, which a real section match plus a couple of keyword
  // hits routinely survives (confirmed live — that's the actual loophole this closes). Politics gets
  // an unconditional rule instead: a confidently-detected foreign country is rejected outright,
  // before any scoring, and nothing computed afterward can rescue it. Checked here rather than
  // folded into scoreArticle's signals so it stays a genuine short-circuit, not one more addend a
  // large enough positive score could out-vote.
  //
  // A country matching one of the channel's own subchannels (gate.politicsExemptCountryCodes) is
  // exempted rather than rejected — this function only ever decides keep-or-reject for THIS target's
  // own bucket; actually moving an exempted article out of the main feed and into that subchannel is
  // routeByCountry's job (main/locality/politicsGeoRouting.ts), run separately in runChannel right
  // after this gate. gate.locality is already null here for a subchannel target whose OWN name is a
  // place (see buildGateContext's fix above), so this block naturally doesn't run against a
  // "Politics · India" subchannel's own India-targeted fetch.
  if (gate.category === 'politics' && gate.locality?.countryCode) {
    const place = detectStoryCountry(article.title, article.snippet, gate.locality.countryCode);
    if (place.kind === 'foreign' && !gate.politicsExemptCountryCodes?.has(place.countryCode)) {
      return { verdict: 'reject', score: W.foreignCountry };
    }
  }

  const signals = scoreArticle(article, gate);
  const score = signals.score;

  if (gate.requireSpecificTerm) {
    // Strict tier (every subchannel + a topic/entity channel's main feed): the specific term must be
    // named (in the title, a provider tag, or the snippet), and the story must not be net-negative.
    // This is what keeps a Star-Trek or generic-marketing story out of a "Phish" channel — a real
    // Phish story names Phish, so a story that never does is dropped.
    if (signals.hasSpecificTerm && score >= KEEP_SCORE) return { verdict: 'keep', score };
    // Borderline: SOME (not all) of a multi-word entity's words appeared, and nothing else already
    // torpedoed the score — this is exactly the "San Francisco Giants" case, real coverage that
    // just says "Giants," not confidently off-topic content.
    if (signals.hasAnySpecificTerm && score >= KEEP_SCORE) return { verdict: 'borderline', score };
    return { verdict: 'reject', score };
  }

  // Lenient tier (a CATEGORY channel's main feed only): keep unless net-negative. Any loose source
  // (the RSS fallback, or a user's own custom source) additionally needs real evidence — without a
  // topic search narrowing what it hands back, a channel's leniency alone would let through whatever
  // that source published recently regardless of fit. "tech" itself never counts as that evidence
  // either way, since it's the ambiguous channel word — that's what keeps "Virginia Tech" out.
  //
  // A single include-keyword hit is NOT enough on its own here — confirmed live as a real failure
  // mode: a general local-news story ("S.F. removes peer counselors from street crisis TEAMS")
  // matched a Sports channel purely because "teams" is in that category's include list, a word that
  // shows up constantly outside sports entirely. A real section-field match is trustworthy on its
  // own (the publisher's own structured categorization, not a coincidental word), but a bare
  // keyword hit needs a SECOND, distinct one alongside it — genuine coverage routinely has that
  // (confirmed live: "...politicians' campaign finance loophole" hits both "politicians" and
  // "campaign"), while a coincidental single-word collision essentially never does.
  if (isLooseProvider(article.provider)) {
    const structurallyStrong = signals.hasSectionMatch || signals.includeHitCount >= 2;
    if (!structurallyStrong) {
      // Borderline: exactly one distinct keyword hit and nothing structural — genuinely uncertain
      // without more context (could be a real but thinly-worded match, could be a coincidence),
      // worth an AI opinion when one's available rather than a flat reject.
      if (signals.includeHitCount === 1 && score >= KEEP_SCORE) return { verdict: 'borderline', score };
      return { verdict: 'reject', score };
    }
  }
  return { verdict: score >= KEEP_SCORE ? 'keep' : 'reject', score };
}

/** Drop off-topic stories from a freshly-fetched batch, keeping the rest in their original order (the
 * feed's newest-first display is applied later, in articlesCache). Applies the soft additive gate
 * above to EVERY provider. Defensive: any error returns the batch unfiltered — a scoring bug must
 * never break a refresh (this app has no error boundary). */
export function filterByRelevance(articles: FetchedArticle[], ctx: RelevanceContext): FetchedArticle[] {
  try {
    const gate = buildGateContext(ctx);
    const kept: FetchedArticle[] = [];
    for (const a of articles) {
      const judgment = judgeArticle(a, gate);
      if (judgment.verdict === 'keep') kept.push({ ...a, relevanceScore: judgment.score });
    }
    return kept;
  } catch (err) {
    console.warn('[relevance] filter error, keeping batch unfiltered', err);
    return articles;
  }
}

/** The 'borderline' set from judgeArticle — stories the strict rules reject on a precision-only
 * technicality (see judgeArticle's own doc comment), worth a second, semantic look from the AI
 * classifier rather than a flat reject. Deliberately a SEPARATE function from filterByRelevance,
 * not a combined return shape — filterByRelevance's existing callers (e.g.
 * server/customSources/sort.ts, which has no AI step downstream at all) shouldn't have to change to
 * keep getting exactly what they already get today. Only worth calling when AI classification is
 * actually configured — see aiRelevance.ts, the only caller. Defensive like filterByRelevance
 * itself: any scoring error returns no borderline candidates rather than throwing, since this is
 * strictly a bonus pass, never load-bearing for a refresh to complete. */
export function borderlineArticles(articles: FetchedArticle[], ctx: RelevanceContext): FetchedArticle[] {
  try {
    const gate = buildGateContext(ctx);
    const borderline: FetchedArticle[] = [];
    for (const a of articles) {
      const judgment = judgeArticle(a, gate);
      if (judgment.verdict === 'borderline') borderline.push({ ...a, relevanceScore: judgment.score });
    }
    return borderline;
  } catch (err) {
    console.warn('[relevance] borderline scan error, skipping AI rescue for this batch', err);
    return [];
  }
}

/* ---------------------------------------------------------------------------------------------------
 * The AI upgrade this heuristic pairs with is IMPLEMENTED, not a sketch:
 *   - providers/classifier.ts   — the model call (Gemini free tier today; swap callModel() for Haiku)
 *   - classificationStore.ts    — cache-by-id + daily cap (the cost/quota controls)
 *   - aiRelevance.ts            — orchestrates: this heuristic first, then the model on what survives
 * refreshAgent calls filterRelevant() from aiRelevance.ts; with no GEMINI_API_KEY set it silently
 * uses this heuristic alone. The channel profile's include/exclude/category are handed to the model as
 * the channel's definition, so its semantic call is far sharper — and it closes the one gap this gate
 * can't: section-less off-topic junk from a primary provider (no section to mismatch, no exclude hit)
 * that a lenient MAIN channel still lets through.
 *
 * TODO(paid-ai): the only remaining paid-tier work is swapping the provider in classifier.ts
 * (Gemini -> Claude Haiku: change callModel()'s endpoint/body + the env key) behind an entitlement
 * flag. Everything else — caching, the daily cap, the heuristic fallback — already applies. Rough
 * economics on Haiku (~$1/M in, ~$5/M out): a heavy 20-channel user at ~1k new articles/day is
 * ~$5/month; typical ~$1-2/month. Sonnet is ~3x for little gain on a keep/drop flag. */
