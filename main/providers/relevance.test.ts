import { describe, it, expect } from 'vitest';
import { filterByRelevance, borderlineArticles, type RelevanceContext } from './relevance';
import { channelProfile } from './channelProfiles';
import { resolveCity } from '../locality/gazetteer';
import type { FetchedArticle } from './types';

const LA = resolveCity('Los Angeles, CA')!;
const CALGARY = resolveCity('Calgary, AB')!;

function article(overrides: Partial<FetchedArticle> = {}): FetchedArticle {
  return {
    url: 'https://example.com/story',
    title: 'Untitled story',
    snippet: null,
    source: 'test-source',
    publishedAt: new Date().toISOString(),
    imageUrl: null,
    section: null,
    tags: null,
    provider: 'guardian',
    ...overrides,
  };
}

function keeps(a: FetchedArticle, ctx: RelevanceContext): boolean {
  return filterByRelevance([a], ctx).length === 1;
}

const noHome: RelevanceContext['homeLocation'] = null;

// ---------------------------------------------------------------------------------------------
// Baseline gate behavior — this logic pre-dates the locality feature and had zero test coverage
// before this suite. These are regression guards for the existing keyword/section/exclude gate,
// not new behavior.
// ---------------------------------------------------------------------------------------------
describe('baseline relevance gate (pre-existing, no locality involved)', () => {
  const techProfile = channelProfile('Tech');

  it('keeps a category main-channel story that never repeats the ambiguous channel word', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const a = article({ title: 'Startup unveils new AI-powered chip for laptops', section: 'technology' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('drops a category story that trips an anti-topic exclude keyword ("Virginia Tech" sports)', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const a = article({ title: 'Virginia Tech Hokies win the quarterback showdown', section: null });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('drops a category story whose section clearly belongs to a different category', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const a = article({ title: 'A quiet afternoon in the newsroom', section: 'sport' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('keeps a category story whose section matches, even with no on-topic keyword', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const a = article({ title: 'A quiet afternoon in the newsroom', section: 'technology' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('drops a topic/entity main-channel story that never names the entity', () => {
    const profile = channelProfile('Phish');
    const ctx: RelevanceContext = { topic: 'Phish', channelName: 'Phish', subchannelName: null, profile, homeLocation: noHome };
    const a = article({ title: 'Star Trek reboot announced for next year', snippet: 'A galaxy-spanning saga.' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('keeps a topic/entity main-channel story that does name the entity', () => {
    const profile = channelProfile('Phish');
    const ctx: RelevanceContext = { topic: 'Phish', channelName: 'Phish', subchannelName: null, profile, homeLocation: noHome };
    const a = article({ title: 'Phish announces summer tour dates' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('drops a subchannel story that never names the subchannel-specific term', () => {
    const profile = channelProfile('Music');
    const ctx: RelevanceContext = { topic: 'Music "Phish"', channelName: 'Music', subchannelName: 'Phish', profile, homeLocation: noHome };
    const a = article({ title: 'New album chart-toppers this week', section: 'music' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('requires positive evidence from the loose RSS fallback provider even on a lenient category main feed', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const a = article({ title: 'Local team advances to regional finals', provider: 'googlenewsrss' });
    expect(keeps(a, ctx)).toBe(false);
  });

  // A user's own added source (server/customSources/) is exactly as loose as the RSS fallback — its
  // results are a site's own general feed, never narrowed by this channel's topic search — so it
  // gets the same extra-strictness treatment. Without this, a general source's off-topic story would
  // slide into a lenient category channel on a technicality (net score 0, no evidence either way).
  it('requires positive evidence from a custom source too, on the same lenient category main feed', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const a = article({ title: 'City council approves new budget for next year', provider: 'custom:abc123' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('still keeps a custom source story that DOES show real positive evidence', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const a = article({ title: 'Startup unveils new AI-powered chip for laptops', provider: 'custom:abc123' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Wrong-sense filtering — a topic channel whose NAME means something else entirely in another
// domain ("Phish" the band vs. "a phish", the attack). Two signals combine: curated wrong-sense
// vocabulary, and the fact that a proper-noun channel name is always capitalized in real coverage.
// ---------------------------------------------------------------------------------------------
describe('wrong-sense filtering (Phish the band vs. a phishing attack)', () => {
  const profile = channelProfile('Phish');
  const ctx: RelevanceContext = {
    topic: 'Phish', channelName: 'Phish', subchannelName: null, profile, homeLocation: noHome,
  };

  it.each([
    'Anatomy of a phish: how attackers steal credentials', // caught by wrong-sense vocabulary
    'This phish targets Microsoft 365 users',
    'How to spot a phish before you click',                // no security words — caught by lowercase
    'Employees keep falling for the same phish',
    'New phishing campaign hits banks',                    // never matched "phish" to begin with
  ])('drops the security-sense story: %s', (title) => {
    expect(keeps(article({ title }), ctx)).toBe(false);
  });

  it.each([
    'Phish announce summer tour dates',
    'Phish debut new song at Madison Square Garden',
    'Phish add second night at the Sphere after selling out',
    'Phish fans report ticket scam ahead of summer tour', // "scam" is deliberately NOT wrong-sense
    'Review: Phish close out a triumphant three-night run',
  ])('keeps the real band story: %s', (title) => {
    expect(keeps(article({ title }), ctx)).toBe(true);
  });

  it('leaves channels without a curated wrong-sense list completely untouched', () => {
    // The capitalization rule must never apply to ordinary topic channels — a lowercase mention
    // in a legitimate story would otherwise start getting penalized everywhere.
    const wildfires = channelProfile('Wildfires');
    expect(wildfires.wrongSense).toEqual([]);
    const wildfireCtx: RelevanceContext = {
      topic: 'Wildfires', channelName: 'Wildfires', subchannelName: null, profile: wildfires, homeLocation: noHome,
    };
    expect(keeps(article({ title: 'Officials warn that wildfires may spread overnight' }), wildfireCtx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Locality signal — the feature added to deprioritize distant local stories in topic/entity
// channels. All scenarios below are the ones manually verified during development; formalized
// here so a future change to the W table or channelProfiles can't silently regress them.
// ---------------------------------------------------------------------------------------------
describe('locality signal — main topic channel (no subchannel)', () => {
  const profile = channelProfile('Wildfires');
  const BANFF_TITLE = 'Fire ban in effect for Banff, Yoho, and Kootenay national parks';
  const BANFF_SNIPPET = 'These fire bans will be implemented to reduce the likelihood of human-caused wildfires.';

  it('is a no-op when no home location is configured', () => {
    const ctx: RelevanceContext = { topic: 'Wildfires', channelName: 'Wildfires', subchannelName: null, profile, homeLocation: noHome };
    const a = article({ title: BANFF_TITLE, snippet: BANFF_SNIPPET, provider: 'googlenewsrss' });
    // Note: uses a primary-tagged provider path implicitly via the specific-term gate, not the
    // fallback-positive-evidence rule (that rule only applies to lenient CATEGORY main feeds).
    expect(keeps(a, ctx)).toBe(true);
  });

  it('drops a far, weak-evidence (snippet-only) story naming the channel term', () => {
    const ctx: RelevanceContext = { topic: 'Wildfires', channelName: 'Wildfires', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: BANFF_TITLE, snippet: BANFF_SNIPPET });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('keeps the same story when home is actually near the mentioned place', () => {
    const ctx: RelevanceContext = { topic: 'Wildfires', channelName: 'Wildfires', subchannelName: null, profile, homeLocation: CALGARY };
    const a = article({ title: BANFF_TITLE, snippet: BANFF_SNIPPET });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('keeps a far story when the channel term is named in the TITLE (strong evidence survives distance)', () => {
    const ctx: RelevanceContext = { topic: 'Wildfires', channelName: 'Wildfires', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Wildfires force evacuations near Banff National Park', snippet: BANFF_SNIPPET });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('is unaffected when the story mentions no resolvable place at all', () => {
    const ctx: RelevanceContext = { topic: 'Wildfires', channelName: 'Wildfires', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'New wildfires prevention guidance issued statewide', snippet: 'Officials urged caution.' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

describe('locality signal — scope guards', () => {
  it('never applies to a topic channel that is itself a place (e.g. "Ukraine")', () => {
    const profile = channelProfile('Ukraine');
    const ctx: RelevanceContext = { topic: 'Ukraine', channelName: 'Ukraine', subchannelName: null, profile, homeLocation: LA };
    const a = article({
      title: 'Ukraine reports new strikes overnight, dozens injured',
      snippet: 'Officials in Kyiv confirmed the strikes on residential buildings.',
    });
    expect(keeps(a, ctx)).toBe(true);
  });

  // Regression coverage for a real bug caught in code review (never shipped live): World's
  // CATEGORY_RULES entry has an empty `include` list by design ("world channels are broad and stay
  // lenient" — see channelProfiles.ts), so a sectionless story there has NO way to earn back a
  // locality penalty. Applying the locality signal to World at all would silently drop ordinary,
  // unremarkable far-away world news for the sole reason that it's... far away, which is backwards
  // for a channel whose entire purpose is showing news from everywhere.
  it('never applies to a World channel, even with a home location set — World has no include keywords to earn the score back', () => {
    const profile = channelProfile('World');
    const ctx: RelevanceContext = { topic: 'World', channelName: 'World', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Jaipur civic body elects new local council chief amid protests' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('never applies to a non-locality category channel (e.g. Sports) — geographic distance isn\'t a meaningful signal there', () => {
    const profile = channelProfile('Sports');
    const ctx: RelevanceContext = { topic: 'Sports', channelName: 'Sports', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Jaipur civic body elects new local council chief amid protests' });
    expect(keeps(a, ctx)).toBe(true);
  });

  // Same guarantees as above, but for a bare COUNTRY/CONTINENT mention (no city named) — the new
  // signal this describe block's siblings below actually test. World/Sports/Entertainment must stay
  // just as untouched by a country-level mention as they already are by a city-level one.
  it('a country mention never applies to World, even with a home location set', () => {
    const profile = channelProfile('World');
    const ctx: RelevanceContext = { topic: 'World', channelName: 'World', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'India announces new trade policy' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('a country mention never applies to Sports, even with a home location set', () => {
    const profile = channelProfile('Sports');
    const ctx: RelevanceContext = { topic: 'Sports', channelName: 'Sports', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Cricket team represents India at international tournament' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('a country mention never applies to Entertainment, even with a home location set', () => {
    const profile = channelProfile('Entertainment');
    const ctx: RelevanceContext = { topic: 'Entertainment', channelName: 'Entertainment', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Bollywood film festival celebrates cinema across India' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

describe('locality signal — the Politics category channel', () => {
  // Real user report: hyperlocal foreign political stories (a district-level story about a
  // politician in India, "and other places") crowding out a broad Politics channel that previously
  // had no way to gauge global interest at all. Scoped to Politics only — see the scope-guard tests
  // above for why this doesn't extend to World or any other category.
  it('drops a weak-evidence, far-away local political story with no other signal', () => {
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Jaipur civic body elects new local council chief amid protests' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('keeps the same shape of story when home is actually near the mentioned place', () => {
    const profile = channelProfile('Politics');
    const jaipur = resolveCity('Jaipur, Rajasthan')!;
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: jaipur };
    const a = article({ title: 'Jaipur civic body elects new local council chief amid protests' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('keeps a far, well-covered story — a real section match plus a keyword hit outweighs the locality penalty', () => {
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Senate votes on new immigration policy near Jaipur-adjacent riding', section: 'politics' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('is unaffected when the story mentions no resolvable place at all', () => {
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Lawmakers debate new voting legislation ahead of recess' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Foreign country/continent signal — the fix for the actual real-world complaint that motivated
// this: routine political (and business/health/science/tech) coverage of a country the user has no
// connection to, that never names a single CITY (only the country, or a person), so the city-only
// locality signal above had literally nothing to find. See W.foreignCountry's own comment in
// relevance.ts for how the -7/-5 weights were derived from the actual scoring ceilings, not guessed.
// ---------------------------------------------------------------------------------------------
describe('locality signal — foreign country (Politics, no city named at all)', () => {
  it('drops a weak-evidence story naming a foreign COUNTRY with no city mentioned', () => {
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'India announces new trade policy' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('is NOT penalized when the mentioned country IS home, even if a foreign country is also named', () => {
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'United States and India sign new policy agreement' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('a bare category main feed cannot outscore the foreign-country penalty even with a section match (the "strong but not absolute" design)', () => {
    // Confirms the penalty reliably wins on a MAIN feed (its real ceiling here is +5: sectionMatch
    // 3 + includeTitle 2 — a category channel's own ambiguous word never counts, so nothing more can
    // stack) — the "exceptional story survives" case needs a subchannel, see the next describe block.
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'India announces new trade policy', section: 'politics' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('a subchannel story with genuinely stacked evidence no longer survives — the Politics hard exclude (see below) is unconditional, unlike every other locality-eligible category', () => {
    // This used to document the opposite: the subchannel's own term scoring once as a specificTerm
    // (termTitle +3) and again via CATEGORY_RULES.politics.include (+2), plus a section match (+3) =
    // +8 before locality, survived the old soft -7 penalty (8-7=1, kept) as the deliberate
    // "exceptionally well-covered story survives" design. That survivability is exactly the loophole
    // reported live (a real section tag plus a couple of keyword hits routinely got a foreign
    // political story through) and is why Politics now has its own hard exclude instead — see
    // "Politics hard exclude" below. Business/Health/Science/Technology keep the old, survivable
    // behavior this test used to assert; the equivalent case for those is covered there.
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics "Elections"', channelName: 'Politics', subchannelName: 'Elections', profile, homeLocation: LA };
    const a = article({ title: 'Elections held across India amid record turnout', section: 'politics' });
    expect(keeps(a, ctx)).toBe(false);
  });
});

describe('locality signal — foreign continent (deliberately weaker than a named country)', () => {
  it('drops a weak-evidence story naming a foreign CONTINENT with no country or city mentioned', () => {
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Political unrest spreads across Africa' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('is NOT penalized when the mentioned continent IS home\'s own continent', () => {
    const profile = channelProfile('Politics');
    const paris = resolveCity('Paris, FR')!;
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: paris };
    const a = article({ title: 'Political unrest spreads across Europe' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('a bare main-feed story that survives the continent penalty would NOT survive the harsher country one at the same evidence level', () => {
    // Same evidence shape (includeTitle + sectionMatch = +5) both times — only the kind of place
    // mentioned differs. This is the concrete demonstration that foreignContinent (-5) is
    // deliberately weaker than foreignCountry (-7): 5-5=0 survives, 5-7=-2 does not.
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const continentStory = article({ title: 'Political unrest spreads across Africa', section: 'politics' });
    const countryStory = article({ title: 'India announces new trade policy', section: 'politics' });
    expect(keeps(continentStory, ctx)).toBe(true);
    expect(keeps(countryStory, ctx)).toBe(false);
  });
});

describe('locality signal — extended to Business/Health/Science/Technology (not just Politics)', () => {
  it('drops a weak-evidence foreign-country business story', () => {
    const profile = channelProfile('Business');
    const ctx: RelevanceContext = { topic: 'Business', channelName: 'Business', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'India announces new tariffs on steel imports' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('drops a weak-evidence foreign-country health story', () => {
    const profile = channelProfile('Health');
    const ctx: RelevanceContext = { topic: 'Health', channelName: 'Health', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'India reports new vaccine rollout nationwide' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('drops a weak-evidence foreign-country science story', () => {
    const profile = channelProfile('Science');
    const ctx: RelevanceContext = { topic: 'Science', channelName: 'Science', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'India announces new climate research initiative' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('drops a weak-evidence foreign-country technology story', () => {
    const profile = channelProfile('Tech');
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'India announces new semiconductor manufacturing policy' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('is unaffected when the business story is genuinely about home', () => {
    const profile = channelProfile('Business');
    const ctx: RelevanceContext = { topic: 'Business', channelName: 'Business', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Markets rally as inflation data beats expectations' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

describe('locality signal — a topic/entity channel gets the gentler weight, not the harsh one', () => {
  // Critical distinction from the category-channel tests above: a topic channel about something
  // fundamentally foreign (here, a channel about India's film industry) must NOT have its own core
  // content wiped out by the very geography it's about — see W.foreignCountry's comment in
  // relevance.ts for the concrete regression this avoids. The widened RECOGNITION (country names now
  // register at all) still applies; only the WEIGHT used differs.
  it('a title-match topic story mentioning a foreign country survives, because a topic channel uses localityFar (-4), not foreignCountry (-7)', () => {
    const profile = channelProfile('Bollywood');
    const ctx: RelevanceContext = { topic: 'Bollywood', channelName: 'Bollywood', subchannelName: null, profile, homeLocation: LA };
    // Floors at +5 here (termTitle 3 + includeTitle 2 — a topic channel's own term is both a
    // specificTerm AND its own include list, same double-count as the Politics subchannel case
    // above). 5 - localityFar(4) = 1, kept. If this had used foreignCountry(-7) instead, 5-7=-2
    // would drop it — that's exactly the regression this design avoids.
    const a = article({ title: 'Bollywood celebrates record year for India\'s film industry' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

describe('locality signal — subchannels (a topic channel with a subchannel target)', () => {
  const profile = channelProfile('Wildfires');
  const BANFF_MENTION = 'near Banff National Park';

  it('drops when only the subchannel-specific term appears (in the snippet), far from home', () => {
    const ctx: RelevanceContext = { topic: 'Wildfires Drought', channelName: 'Wildfires', subchannelName: 'Drought', profile, homeLocation: LA };
    const a = article({ title: `Update issued ${BANFF_MENTION}`, snippet: 'Drought conditions remain a concern for officials.' });
    expect(keeps(a, ctx)).toBe(false);
  });

  // KNOWN, DOCUMENTED NUANCE (see the comment in relevance.ts above the locality scoring block):
  // a subchannel-only term named in the TITLE does not get the channel's "include" bonus, so it
  // floors lower than the equivalent main-channel case and CAN still be dropped by the locality
  // penalty. This mirrors subchannels already being the strict tier elsewhere in this gate.
  it('drops even when the subchannel-specific term is named in the TITLE, if the channel word is absent', () => {
    const ctx: RelevanceContext = { topic: 'Wildfires Drought', channelName: 'Wildfires', subchannelName: 'Drought', profile, homeLocation: LA };
    const a = article({ title: `Drought forces new restrictions ${BANFF_MENTION}` });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('keeps when BOTH the channel word and the subchannel term appear, even far from home', () => {
    const ctx: RelevanceContext = { topic: 'Wildfires Drought', channelName: 'Wildfires', subchannelName: 'Drought', profile, homeLocation: LA };
    const a = article({ title: `Wildfires and drought force new restrictions ${BANFF_MENTION}` });
    expect(keeps(a, ctx)).toBe(true);
  });
});

describe('Politics hard exclude — a confidently-foreign story is rejected outright, not scored', () => {
  const politics = channelProfile('Politics');

  it('rejects a foreign-country Politics story even with a real section match AND a keyword hit', () => {
    // A section match (+3) plus a title keyword hit (+2) is exactly the shape of evidence that
    // routinely cleared the old soft -7 penalty in production (a section field is the publisher's
    // own structured categorization, not a coincidental word) — this combination surviving is the
    // actual loophole the hard exclude exists to close, regardless of the precise arithmetic under
    // the old scheme in any one channel-type/evidence combination.
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile: politics, homeLocation: LA };
    const a = article({ title: 'India announces new election reform policy', section: 'politics' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('does not reject a home-country Politics story', () => {
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile: politics, homeLocation: LA };
    const a = article({ title: 'Senate advances new budget bill', section: 'politics' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('does not reject a Politics story naming both a foreign country and home', () => {
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile: politics, homeLocation: LA };
    const a = article({ title: 'United States and India sign new trade deal', section: 'politics' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('rejects a foreign REGION mention with no country name (Osun/Kerala) just as confidently as a named country', () => {
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile: politics, homeLocation: LA };
    const a = article({ title: 'Osun 2026: Parade of Paradox and Parody of Politics', section: 'politics' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('does not apply the hard exclude to other locality-eligible categories — Business keeps the exact "genuinely stacked evidence survives" behavior the equivalent Politics case above no longer has', () => {
    // Mirrors the Politics subchannel test above (now updated to expect rejection) exactly, on a
    // Business channel instead: term counted twice (specificTerm + include) plus a section match =
    // +8, 8-7=1, kept. This must still behave exactly as it did before this feature — the ask was
    // Politics-only, and this is the direct proof the other locality categories were left alone.
    const business = channelProfile('Business');
    const ctx: RelevanceContext = { topic: 'Business "Tariffs"', channelName: 'Business', subchannelName: 'Tariffs', profile: business, homeLocation: LA };
    const a = article({ title: 'Tariffs imposed across India amid trade tensions', section: 'business' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('a bare foreign continent mention (no specific country) is untouched by the hard exclude, same as before', () => {
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile: politics, homeLocation: LA };
    const a = article({ title: 'Political unrest spreads across Africa', section: 'politics' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

describe('Politics hard exclude — home institution signal (regression coverage for a real, confirmed bug)', () => {
  // Confirmed live: the hard exclude above was rejecting the MAJORITY of a real Politics channel's
  // content, not just the regional coverage it was built for — any ordinary US political story that
  // discusses foreign policy (a sanctions bill, a foreign aid package, a tariff fight) names the
  // foreign country as the OBJECT of a US action without ever needing to also say "United States,"
  // which is most of what real political news actually is. See placeExtraction.test.ts's own
  // "home institution signal" tests for the detection logic itself — these confirm the fix reaches
  // all the way through the actual keep/reject decision, not just the detector in isolation.
  const politics = channelProfile('Politics');

  it.each([
    'Senate approves new sanctions package targeting Russia',
    'Congress moves to restrict TikTok over China ties',
  ])('keeps a genuine US political story that names a foreign country only as the object of US action: %s', (title) => {
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile: politics, homeLocation: LA };
    const a = article({ title, section: 'politics' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('still rejects the original motivating case — a foreign story with no home institution mentioned', () => {
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile: politics, homeLocation: LA };
    const a = article({ title: 'Osun 2026: Parade of Paradox and Parody of Politics', section: 'politics' });
    expect(keeps(a, ctx)).toBe(false);
  });
});

describe('Politics hard exclude — subchannel exemption', () => {
  const politics = channelProfile('Politics');

  it('exempts a foreign country matching a sibling subchannel from the hard exclude, on the MAIN target', () => {
    const ctx: RelevanceContext = {
      topic: 'Politics',
      channelName: 'Politics',
      subchannelName: null,
      profile: politics,
      homeLocation: LA,
      siblingSubchannelNames: ['India'],
    };
    const a = article({ title: 'India announces new election reform policy', section: 'politics' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('still hard-excludes a foreign country with NO matching subchannel, even when other subchannels exist', () => {
    const ctx: RelevanceContext = {
      topic: 'Politics',
      channelName: 'Politics',
      subchannelName: null,
      profile: politics,
      homeLocation: LA,
      siblingSubchannelNames: ['Elections'],
    };
    const a = article({ title: 'India announces new election reform policy', section: 'politics' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('prerequisite bug fix: a subchannel named after the very place it is about is no longer penalized on its OWN dedicated fetch', () => {
    // Found while building this feature: buildGateContext's place-channel exemption only ever
    // checked the PARENT channel's name, never the current batch's own subchannelName — so a
    // "Politics · India" subchannel's own dedicated fetch (topic: "Politics India") was already
    // being penalized by the pre-existing soft foreign-country signal for being about India, before
    // this feature existed. Without this fix, the escape valve this feature relies on doesn't work.
    const ctx: RelevanceContext = { topic: 'Politics India', channelName: 'Politics', subchannelName: 'India', profile: politics, homeLocation: LA };
    const a = article({ title: 'India announces new election reform policy', section: 'politics' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

describe('locality signal — performance', () => {
  it('filters a large batch of articles well within a sane latency budget', () => {
    const profile = channelProfile('Wildfires');
    const ctx: RelevanceContext = { topic: 'Wildfires', channelName: 'Wildfires', subchannelName: null, profile, homeLocation: LA };
    const batch = Array.from({ length: 2000 }, (_, i) =>
      article({
        title: `Fire ban in effect for Banff, Yoho, and Kootenay national parks (update ${i})`,
        snippet: 'These fire bans will be implemented to reduce the likelihood of human-caused wildfires.',
      })
    );

    const start = performance.now();
    filterByRelevance(batch, ctx);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------------------------
// Regression coverage for two real false positives caught live-testing custom sources against an
// actual account (Mission Local, a general SF news feed, with no topic search narrowing its
// results). Both fixes tighten precision at the cost of recall, deliberately — see relevance.ts's
// own comments for the reasoning.
// ---------------------------------------------------------------------------------------------
describe('multi-word specific terms require ALL words, not just one', () => {
  it('does not match a bare "man" story against a "Spider-Man" topic channel', () => {
    const profile = channelProfile('Spider-Man');
    const ctx: RelevanceContext = { topic: 'Spider-Man', channelName: 'Spider-Man', subchannelName: null, profile, homeLocation: noHome };
    const a = article({ title: 'Man arrested for Sunnydale killing linked to 2015 drive-by shooting' });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('still matches genuine coverage that names the whole entity', () => {
    const profile = channelProfile('Spider-Man');
    const ctx: RelevanceContext = { topic: 'Spider-Man', channelName: 'Spider-Man', subchannelName: null, profile, homeLocation: noHome };
    const a = article({ title: 'New Spider-Man trailer breaks streaming records' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('still requires only the one word for a genuinely single-word entity (no regression)', () => {
    const profile = channelProfile('Phish');
    const ctx: RelevanceContext = { topic: 'Phish', channelName: 'Phish', subchannelName: null, profile, homeLocation: noHome };
    const a = article({ title: 'Phish announces summer tour dates' });
    expect(keeps(a, ctx)).toBe(true);
  });
});

describe('loose providers on a category main feed need two distinct keyword hits, not just one', () => {
  it('rejects a generic-word collision (a real local-news story matching "teams" in a Sports channel)', () => {
    const profile = channelProfile('Sports');
    const ctx: RelevanceContext = { topic: 'Sports', channelName: 'Sports', subchannelName: null, profile, homeLocation: noHome };
    const a = article({
      title: 'S.F. removes peer counselors from street crisis teams amid pleas to keep them',
      provider: 'custom:abc123',
    });
    expect(keeps(a, ctx)).toBe(false);
  });

  it('keeps a story with two distinct on-topic keywords', () => {
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: noHome };
    const a = article({
      title: "S.F. ethics commission votes to end politicians' campaign finance loophole",
      provider: 'custom:abc123',
    });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('keeps a single-keyword-only match when it comes with a real section field', () => {
    const profile = channelProfile('Sports');
    const ctx: RelevanceContext = { topic: 'Sports', channelName: 'Sports', subchannelName: null, profile, homeLocation: noHome };
    const a = article({
      title: 'Local team advances to regional finals',
      section: 'sport',
      provider: 'custom:abc123',
    });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('a single keyword hit alone is still not enough without a section match', () => {
    const profile = channelProfile('Sports');
    const ctx: RelevanceContext = { topic: 'Sports', channelName: 'Sports', subchannelName: null, profile, homeLocation: noHome };
    const a = article({ title: 'Local team advances to regional finals', provider: 'custom:abc123' });
    expect(keeps(a, ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// relevanceScore — the ranking signal filterByRelevance/borderlineArticles now attach to every
// surviving article (see FetchedArticle.relevanceScore), reusing the same additive score that
// already decided keep/reject rather than discarding it. These are regression guards on the
// ranking-relevant ordering, not on the keep/reject boundary itself (that's covered above).
// ---------------------------------------------------------------------------------------------
describe('relevanceScore — the persisted ranking signal', () => {
  const techProfile = channelProfile('Tech');

  it('attaches a higher score to a story with stronger on-topic evidence than a weaker one', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    // Section match (+3) plus a title keyword (+2) — strong, structured evidence.
    const strong = article({ title: 'New chip startup unveils AI laptop', section: 'technology' });
    // A single, weaker snippet-only keyword hit, no section field at all.
    const weak = article({ title: 'A quiet afternoon in the newsroom', snippet: 'The new chip launch got a brief mention.', section: null });

    const [strongResult] = filterByRelevance([strong], ctx);
    const [weakResult] = filterByRelevance([weak], ctx);

    expect(strongResult.relevanceScore).toBeGreaterThan(weakResult.relevanceScore!);
  });

  it('does not attach a score to a rejected article (it never reaches the kept array at all)', () => {
    const ctx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const a = article({ title: 'Virginia Tech Hokies win the quarterback showdown', section: null });
    expect(filterByRelevance([a], ctx)).toEqual([]);
  });

  it('borderlineArticles attaches a score too, so an AI-rescued story is still rankable', () => {
    const giantsProfile = channelProfile('San Francisco Giants');
    const ctx: RelevanceContext = { topic: 'San Francisco Giants', channelName: 'San Francisco Giants', subchannelName: null, profile: giantsProfile, homeLocation: noHome };
    const a = article({ title: 'Giants win 5-2 behind a strong outing from the bullpen' });

    const [result] = borderlineArticles([a], ctx);
    expect(result.relevanceScore).toBeTypeOf('number');
  });
});

// ---------------------------------------------------------------------------------------------
// Trusted sources — a mild, unconditional score boost for a publisher domain the user has marked
// trusted (Settings.trustedSourceDomains), applied identically across every channel type.
// ---------------------------------------------------------------------------------------------
describe('trusted sources', () => {
  const techProfile = channelProfile('Tech');

  it('scores a story from a trusted domain higher than the same story from an untrusted one', () => {
    const untrustedCtx: RelevanceContext = { topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome };
    const trustedCtx: RelevanceContext = { ...untrustedCtx, trustedSourceDomains: ['reuters.com'] };
    const a = article({ title: 'New chip startup unveils AI laptop', section: 'technology', url: 'https://reuters.com/tech/story' });

    const [untrusted] = filterByRelevance([a], untrustedCtx);
    const [trusted] = filterByRelevance([a], trustedCtx);

    expect(trusted.relevanceScore).toBeGreaterThan(untrusted.relevanceScore!);
  });

  it('matches a subdomain of a trusted domain', () => {
    const ctx: RelevanceContext = {
      topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome,
      trustedSourceDomains: ['nytimes.com'],
    };
    const a = article({ title: 'New chip startup unveils AI laptop', section: 'technology', url: 'https://cooking.nytimes.com/tech/story' });
    const untrustedCtx: RelevanceContext = { ...ctx, trustedSourceDomains: [] };

    const [trusted] = filterByRelevance([a], ctx);
    const [untrusted] = filterByRelevance([a], untrustedCtx);
    expect(trusted.relevanceScore).toBeGreaterThan(untrusted.relevanceScore!);
  });

  it('does not let a trusted source alone rescue a clearly off-topic story', () => {
    const ctx: RelevanceContext = {
      topic: 'Tech', channelName: 'Tech', subchannelName: null, profile: techProfile, homeLocation: noHome,
      trustedSourceDomains: ['reuters.com'],
    };
    const a = article({ title: 'Virginia Tech Hokies win the quarterback showdown', section: null, url: 'https://reuters.com/sports/story' });
    expect(keeps(a, ctx)).toBe(false);
  });
});
