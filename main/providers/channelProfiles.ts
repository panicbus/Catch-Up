/** Pure, Electron-agnostic channel "profiles" — the auto-seeded rules that gatekeep what gets into a
 * channel (see relevance.ts). No persisted config: a profile is derived from the channel NAME via the
 * tables below, so it works with zero setup and can be overridden/edited later.
 *
 * A channel is either a CATEGORY (Music, Politics, Tech — a broad bucket; can't require the word in a
 * headline) or a TOPIC/entity (Phish, Alameda, a person — must be named). Category channels lean on
 * their news category + a section signal + keyword include/exclude; topic channels require the term. */

import { normalizeTitle } from './dedupe';

export type NewsCategory =
  | 'entertainment'
  | 'technology'
  | 'politics'
  | 'sports'
  | 'business'
  | 'science'
  | 'health'
  | 'world';

export interface ChannelProfile {
  type: 'category' | 'topic';
  category: NewsCategory | null;
  /** Topic-expansion keywords that qualify a story (category channels); for topic channels this is
   * the channel's own term(s) that must appear. */
  include: string[];
  /** Anti-topic keywords that disqualify a story. */
  exclude: string[];
}

/** Per-category keyword rules + the section names each provider uses for that category. All keyword
 * matching downstream (relevance.ts) is WHOLE-WORD, so these lists hold real word forms — including
 * the plurals/adjective forms that matter — not stems ("politics"/"political", not "politic"). The
 * category's own name word is deliberately kept OUT of `include` when it's ambiguous (e.g. "tech",
 * which appears in "Virginia Tech"/"Tech Ridge"): it lives in `triggers` to classify the channel, but
 * must not count as on-topic evidence for an article. `sections` are substring-matched (lowercased)
 * against a provider's returned section AND against clean single-word URL path segments. */
interface CategoryRule {
  /** Channel-name triggers that map a channel to this category. */
  triggers: string[];
  /** Disambiguating on-topic keywords (NOT the ambiguous category name itself). */
  include: string[];
  /** Anti-topic keywords that signal the story belongs to a different category. */
  exclude: string[];
  /** Section/desk strings (from providers) that count as a MATCH for this category. */
  sections: string[];
}

const CATEGORY_RULES: Record<NewsCategory, CategoryRule> = {
  entertainment: {
    triggers: ['music', 'movies', 'movie', 'film', 'films', 'cinema', 'pop culture', 'entertainment', 'tv', 'television', 'celebrity', 'art', 'arts', 'culture', 'theater', 'theatre', 'gaming'],
    include: ['music', 'album', 'albums', 'song', 'songs', 'band', 'bands', 'tour', 'concert', 'concerts', 'festival', 'festivals', 'setlist', 'setlists', 'singer', 'singers', 'rapper', 'dj', 'film', 'films', 'movie', 'movies', 'trailer', 'cinema', 'tv', 'series', 'episode', 'actor', 'actress', 'director', 'celebrity', 'premiere', 'netflix', 'grammy', 'grammys', 'oscar', 'oscars', 'gallery', 'artist', 'artists', 'soundtrack', 'box office'],
    exclude: [],
    sections: ['culture', 'music', 'film', 'movies', 'tv-and-radio', 'television', 'entertainment', 'arts', 'stage', 'games'],
  },
  technology: {
    // 'tech'/'technology' are triggers only — NOT include — so "Virginia Tech"/"Tech Ridge" can't
    // score as on-topic. Real tech stories qualify on the disambiguating words below or a tech section.
    triggers: ['tech', 'technology', 'ai', 'artificial intelligence', 'software', 'gadgets', 'startup', 'startups', 'computing', 'crypto', 'science and tech'],
    include: ['ai', 'software', 'app', 'apps', 'gadget', 'gadgets', 'chip', 'chips', 'semiconductor', 'startup', 'startups', 'iphone', 'android', 'smartphone', 'google', 'microsoft', 'openai', 'computing', 'hardware', 'cybersecurity', 'crypto', 'robot', 'robots', 'gpu', 'laptop', 'algorithm', 'quantum', 'coding', 'programming'],
    exclude: ['hokies', 'ncaa', 'quarterback', 'touchdown', 'virginia tech', 'texas tech', 'georgia tech'],
    sections: ['technology', 'tech'],
  },
  politics: {
    triggers: ['politics', 'political', 'election', 'elections', 'government', 'congress', 'senate', 'policy', 'washington', 'white house'],
    include: ['politics', 'political', 'politician', 'politicians', 'election', 'elections', 'senate', 'senator', 'congress', 'congressional', 'president', 'presidential', 'government', 'governor', 'policy', 'campaign', 'vote', 'votes', 'voter', 'voters', 'legislation', 'lawmaker', 'lawmakers', 'parliament', 'democrat', 'democrats', 'republican', 'republicans', 'ballot'],
    exclude: ['movie', 'movies', 'film', 'films', 'trailer', 'box office', 'episode', 'album', 'concert', 'recipe', 'netflix', 'grammy', 'oscar'],
    sections: ['politics', 'us politics', 'world politics'],
  },
  sports: {
    triggers: ['sports', 'sport', 'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'tennis', 'golf', 'cycling', 'tour de france', 'olympics'],
    include: ['game', 'games', 'match', 'matches', 'playoff', 'playoffs', 'championship', 'coach', 'player', 'players', 'team', 'teams', 'league', 'tournament', 'tournaments', 'goal', 'goals', 'touchdown', 'quarterback', 'striker', 'midfielder', 'medal', 'medals'],
    exclude: [],
    sections: ['sport', 'sports'],
  },
  business: {
    triggers: ['business', 'finance', 'economy', 'economics', 'markets', 'market', 'stocks', 'unemployment', 'money', 'trade'],
    include: ['economy', 'economic', 'market', 'markets', 'stock', 'stocks', 'shares', 'inflation', 'unemployment', 'jobless', 'gdp', 'fed', 'earnings', 'revenue', 'nasdaq', 'recession', 'layoffs', 'layoff', 'tariff', 'tariffs', 'finance', 'interest rate', 'wall street'],
    exclude: [],
    sections: ['business', 'money', 'markets', 'economy'],
  },
  science: {
    triggers: ['science', 'space', 'physics', 'biology', 'climate', 'research'],
    include: ['science', 'scientific', 'research', 'researchers', 'study', 'studies', 'scientist', 'scientists', 'space', 'nasa', 'climate', 'physics', 'biology', 'chemistry', 'experiment', 'discovery', 'telescope', 'genome', 'fossil'],
    exclude: [],
    sections: ['science', 'environment'],
  },
  health: {
    triggers: ['health', 'medicine', 'medical', 'wellness', 'fitness'],
    include: ['health', 'medical', 'medicine', 'disease', 'diseases', 'vaccine', 'vaccines', 'hospital', 'hospitals', 'doctor', 'doctors', 'patient', 'patients', 'wellness', 'fitness', 'nutrition', 'cancer', 'virus', 'outbreak', 'mental health'],
    exclude: [],
    sections: ['health', 'wellness'],
  },
  world: {
    // Deliberately narrow: 'world' channels are broad and stay lenient. Keeping the section list tight
    // (no bare 'news') avoids wrongly flagging generic stories as "foreign" to other categories.
    triggers: ['world', 'international', 'global', 'nation', 'national'],
    include: [],
    exclude: [],
    sections: ['world', 'us news', 'uk news'],
  },
};

/** Tokenize a channel/topic name into meaningful words (reuses the title normalizer). */
function tokens(name: string): string[] {
  return normalizeTitle(name).split(' ').filter(Boolean);
}

/** Match a channel name to a category, or null if it's a specific topic/entity. Prefers a full-name
 * trigger match, then a single-token match. */
function matchCategory(name: string): NewsCategory | null {
  const normalized = normalizeTitle(name);
  const nameTokens = new Set(tokens(name));
  for (const [category, rule] of Object.entries(CATEGORY_RULES) as [NewsCategory, CategoryRule][]) {
    for (const trigger of rule.triggers) {
      // Whole-phrase trigger present, or a single-word trigger that is one of the name's tokens.
      if (trigger.includes(' ') ? normalized.includes(trigger) : nameTokens.has(trigger)) {
        return category;
      }
    }
  }
  return null;
}

/** Derive a channel's profile from its name. */
export function channelProfile(name: string): ChannelProfile {
  const category = matchCategory(name);
  if (category) {
    const rule = CATEGORY_RULES[category];
    return { type: 'category', category, include: rule.include, exclude: rule.exclude };
  }
  // Topic/entity channel — the name itself is what must appear.
  return { type: 'topic', category: null, include: tokens(name), exclude: [] };
}

/** Does a provider-reported section belong to this category? (substring match, lowercased) */
export function sectionMatchesCategory(section: string, category: NewsCategory): boolean {
  const s = section.toLowerCase();
  return CATEGORY_RULES[category].sections.some((sec) => s.includes(sec));
}

/** Does a section clearly belong to a DIFFERENT category than the channel's? (hard mismatch → drop) */
export function sectionIsForeign(section: string, category: NewsCategory): boolean {
  const s = section.toLowerCase();
  if (sectionMatchesCategory(s, category)) return false;
  for (const [cat, rule] of Object.entries(CATEGORY_RULES) as [NewsCategory, CategoryRule][]) {
    if (cat === category) continue;
    if (rule.sections.some((sec) => s.includes(sec))) return true;
  }
  return false;
}

/** Maps a NewsCategory to a provider's own category/section query param, for the two providers whose
 * category filter is reliable enough to narrow the request server-side. GNews (/search has no
 * category param) and NYT (rate-limited, fragile desk mapping) instead read their section back and
 * lean on the downstream scorer — see their provider files. */
export const PROVIDER_CATEGORY: Record<'newsdata' | 'guardian', Partial<Record<NewsCategory, string>>> = {
  // NewsData /news categories.
  newsdata: {
    entertainment: 'entertainment',
    technology: 'technology',
    politics: 'politics',
    sports: 'sports',
    business: 'business',
    science: 'science',
    health: 'health',
    world: 'world',
  },
  // Guardian sections.
  guardian: {
    entertainment: 'culture',
    technology: 'technology',
    politics: 'politics',
    sports: 'sport',
    business: 'business',
    science: 'science',
    health: 'society',
    world: 'world',
  },
};
