/** Pure, Electron-agnostic relevance gate — same portability contract as the rest of this folder
 * (see types.ts): only plain JS, no Node/Electron APIs, so it lifts straight into a future hosted
 * backend. Reused by refreshAgent between fetching and saving.
 *
 * The problem it solves: a channel is populated by sending its name verbatim as a keyword search to
 * each provider, and whatever comes back is stored as-is. The last-resort Google News RSS fallback
 * (see registry.ts) is a loose keyword search with no real snippet — it's the main source of
 * wrong-sense junk ("Virginia Tech" for a Tech channel) that backfills thin channels.
 *
 * WHY ONLY THE FALLBACK IS GATED: the primary providers (NewsData, Guardian, GNews, NYT, HN) search
 * the FULL article body with their own relevance models, then return what they judge relevant. We
 * only get an article's title + snippet + source here — far less than they matched on. So re-judging
 * a primary result by keyword would wrongly drop good stories: a "Pop Culture" or "Art" channel's
 * real articles rarely contain the literal words "pop"/"culture"/"art" in the headline. We therefore
 * TRUST the primaries and only hold the loose RSS fallback to a keyword check. Semantic filtering of
 * primary results (reading the snippet's meaning, not its words) is the LLM's job — scaffolded at the
 * bottom of this file. */

import { normalizeTitle } from './dedupe';
import type { FetchedArticle } from './types';

// The loose, last-resort fallback provider (see registry.ts). Only its results are gated here.
const FALLBACK_PROVIDER_ID = 'googlenewsrss';

// Tiny stopword set so a multi-word topic ("The Pool", "de France") isn't matched on filler words.
// Deliberately minimal — we only want to avoid matching on words that carry no topic meaning.
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'de', 'la']);

export interface QueryTerms {
  /** Meaningful, de-duplicated topic tokens (lowercased, stopwords removed). */
  terms: string[];
}

/** Tokenize a provider search topic into scorable terms. `normalizeTitle` already lowercases and
 * turns punctuation (including the quotes asSearchPhrase adds) into spaces, so `"Phish Setlists"`
 * and `Music "Phish Setlists"` both reduce cleanly to word tokens. */
export function buildQueryTerms(topic: string): QueryTerms {
  const tokens = normalizeTitle(topic).split(' ').filter(Boolean);
  const terms = [...new Set(tokens.filter((t) => !STOPWORDS.has(t)))];
  return { terms };
}

// Whole-word match (padded spaces) so "art" doesn't match inside "startup". This is still just
// keyword matching — it intentionally can't tell "Virginia Tech" from "tech news"; that's the LLM's
// job — but for the snippet-less RSS fallback it's the only signal available, and it reliably drops
// results that share no word with the topic at all.
function hasWord(haystack: string, term: string): boolean {
  return ` ${haystack} `.includes(` ${term} `);
}

/** A Google News RSS result is kept only if a topic term actually appears in its title or snippet.
 * (Source-only matches don't count — RSS source strings are noisy and it has no meaningful snippet.) */
function fallbackIsRelevant(article: FetchedArticle, query: QueryTerms): boolean {
  const title = normalizeTitle(article.title);
  const snippet = article.snippet ? normalizeTitle(article.snippet) : '';
  return query.terms.some((t) => hasWord(title, t) || hasWord(snippet, t));
}

/** Drop clearly off-topic stories from a freshly-fetched batch, keeping the rest in their original
 * order (the feed's newest-first display is applied later, in articlesCache). Primary providers are
 * trusted as-is; only the loose Google News RSS fallback is keyword-gated. `topic` is the exact
 * provider search string (channel name, or `Channel "Subchannel"`). Defensive: any error returns the
 * batch unfiltered — a scoring bug must never break a refresh (this app has no error boundary). */
export function filterByRelevance(articles: FetchedArticle[], topic: string): FetchedArticle[] {
  try {
    const query = buildQueryTerms(topic);
    if (query.terms.length === 0) return articles; // nothing meaningful to match on — keep everything
    return articles.filter(
      (a) => a.provider !== FALLBACK_PROVIDER_ID || fallbackIsRelevant(a, query)
    );
  } catch (err) {
    console.warn('[relevance] filter error, keeping batch unfiltered', err);
    return articles;
  }
}

/* ---------------------------------------------------------------------------------------------------
 * The AI upgrade this heuristic pairs with is now IMPLEMENTED, not a sketch:
 *   - providers/classifier.ts   — the model call (Gemini free tier today; swap callModel() for Haiku)
 *   - classificationStore.ts    — cache-by-id + daily cap (the cost/quota controls)
 *   - aiRelevance.ts            — orchestrates: this heuristic first, then the model on what survives
 * refreshAgent calls filterRelevant() from aiRelevance.ts; with no GEMINI_API_KEY set it silently
 * uses this heuristic alone. The model reads the snippet's MEANING, so it also drops the tangential
 * primary-provider results this keyword pass can't (a "Pop Culture" story stays, "Virginia Tech" for
 * a Tech channel goes).
 *
 * TODO(paid-ai): the only remaining paid-tier work is swapping the provider in classifier.ts
 * (Gemini -> Claude Haiku: change callModel()'s endpoint/body + the env key) behind an entitlement
 * flag. Everything else — caching, the daily cap, the heuristic fallback — already applies. Rough
 * economics on Haiku (~$1/M in, ~$5/M out): a heavy 20-channel user at ~1k new articles/day is
 * ~$5/month; typical ~$1-2/month. Sonnet is ~3x for little gain on a keep/drop flag. */
