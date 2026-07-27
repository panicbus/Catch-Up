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
 *     word (a real music story rarely says "music"). The lone exception is the loose Google-News RSS
 *     fallback, which must still show SOME positive evidence (it's the main source of wrong-sense junk).
 *   - SUBCHANNELS are STRICT: the specific subchannel/entity term must appear, plus the same
 *     negative-signal drops. Subchannels are precise, so "when in doubt, keep out" applies there.
 *
 * The ambiguous category word itself ("tech", "music") is NEVER scored as positive evidence for a
 * category channel — that's what let "Virginia Tech" through. It classifies the channel (a trigger in
 * channelProfiles.ts) but an article has to earn relevance on the disambiguating keywords/section. */

import { normalizeTitle } from './dedupe';
import { sectionMatchesCategory, sectionIsForeign } from './channelProfiles';
import type { ChannelProfile, NewsCategory } from './channelProfiles';
import type { FetchedArticle } from './types';

// The loose, last-resort fallback provider (see registry.ts). Held to extra strictness below.
const FALLBACK_PROVIDER_ID = 'googlenewsrss';

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
};
const KEEP_SCORE = 0; // keep when the summed score is >= this (i.e. not net-negative)

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
  /** A specific (non-ambiguous) term appeared — the gate for strict subchannel keeps. */
  hasSpecificTerm: boolean;
  /** ANY on-topic evidence appeared — the gate for keeping a loose RSS-fallback result. */
  hasPositive: boolean;
}

interface GateContext {
  /** Terms that must appear for a subchannel and score as strong positives (the ambiguous channel
   * name is removed for category channels, so it never counts). */
  specificTerms: string[];
  include: string[];
  exclude: string[];
  category: NewsCategory | null;
  isSubchannel: boolean;
}

function buildGateContext(ctx: RelevanceContext): GateContext {
  const allTerms = buildQueryTerms(ctx.topic).terms;
  // For a category channel the channel-name word(s) are ambiguous (they're why it's a category), so
  // strip them from the scorable terms; whatever remains is subchannel/entity-specific. For a topic
  // channel every term is specific.
  const ambiguous =
    ctx.profile.type === 'category' ? new Set(buildQueryTerms(ctx.channelName).terms) : new Set<string>();
  const specificTerms = allTerms.filter((t) => !ambiguous.has(t));
  return {
    specificTerms,
    include: ctx.profile.include,
    exclude: ctx.profile.exclude,
    category: ctx.profile.category,
    isSubchannel: ctx.subchannelName != null,
  };
}

function scoreArticle(article: FetchedArticle, gate: GateContext): ScoredSignals {
  const title = normalizeTitle(article.title);
  const snippet = article.snippet ? normalizeTitle(article.snippet) : '';
  // The source's own topic tags (Guardian/NYT/NewsData), joined into one searchable string. A clean,
  // curated signal — a story tagged "Taylor Swift"/"Music" is on-topic even when the headline hides it.
  const tags = article.tags && article.tags.length ? normalizeTitle(article.tags.join(' ')) : '';
  let score = 0;
  let hasSpecificTerm = false;
  let hasPositive = false;

  // Specific terms (the entity, or the subchannel's narrowing words) — count once, best source wins.
  for (const t of gate.specificTerms) {
    if (hasWord(title, t)) {
      score += W.termTitle;
      hasSpecificTerm = true;
      hasPositive = true;
    } else if (hasWord(tags, t)) {
      score += W.termTag;
      hasSpecificTerm = true;
      hasPositive = true;
    } else if (hasWord(snippet, t)) {
      score += W.termSnippet;
      hasSpecificTerm = true;
      hasPositive = true;
    }
  }

  // Category disambiguating keywords — count once, best source wins (title > tag > snippet).
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

  // Anti-topic keywords — a clear negative, in the title, a tag, or the snippet.
  if (hasAnyWord(title, gate.exclude) || hasAnyWord(tags, gate.exclude) || hasAnyWord(snippet, gate.exclude)) {
    score += W.excludeHit;
  }

  // Section evidence (category channels only). Prefer the provider's real section field; only if it's
  // absent do we fall back to a URL-path hint.
  if (gate.category) {
    if (article.section) {
      if (sectionMatchesCategory(article.section, gate.category)) {
        score += W.sectionMatch;
        hasPositive = true;
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

  return { score, hasSpecificTerm, hasPositive };
}

function keepArticle(article: FetchedArticle, gate: GateContext): boolean {
  const signals = scoreArticle(article, gate);

  if (gate.isSubchannel) {
    // Strict: must name a specific term, and must not be net-negative.
    return signals.hasSpecificTerm && signals.score >= KEEP_SCORE;
  }

  // Main channel: lenient — keep unless net-negative. The loose RSS fallback additionally needs some
  // positive evidence (its keyword search is the main source of wrong-sense noise, e.g. "Virginia
  // Tech" for a Tech channel — which now scores nothing, since "tech" is the ambiguous channel word).
  if (article.provider === FALLBACK_PROVIDER_ID && !signals.hasPositive) return false;
  return signals.score >= KEEP_SCORE;
}

/** Drop off-topic stories from a freshly-fetched batch, keeping the rest in their original order (the
 * feed's newest-first display is applied later, in articlesCache). Applies the soft additive gate
 * above to EVERY provider. Defensive: any error returns the batch unfiltered — a scoring bug must
 * never break a refresh (this app has no error boundary). */
export function filterByRelevance(articles: FetchedArticle[], ctx: RelevanceContext): FetchedArticle[] {
  try {
    const gate = buildGateContext(ctx);
    return articles.filter((a) => keepArticle(a, gate));
  } catch (err) {
    console.warn('[relevance] filter error, keeping batch unfiltered', err);
    return articles;
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
