import { describe, it, expect } from 'vitest';
import { filterByRelevance, type RelevanceContext } from './relevance';
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
  it('never applies to a broad category channel, regardless of home location', () => {
    const profile = channelProfile('Politics');
    const ctx: RelevanceContext = { topic: 'Politics', channelName: 'Politics', subchannelName: null, profile, homeLocation: LA };
    const a = article({ title: 'Senate votes on new immigration policy near Banff-adjacent riding', section: 'politics' });
    expect(keeps(a, ctx)).toBe(true);
  });

  it('never applies to a topic channel that is itself a place (e.g. "Ukraine")', () => {
    const profile = channelProfile('Ukraine');
    const ctx: RelevanceContext = { topic: 'Ukraine', channelName: 'Ukraine', subchannelName: null, profile, homeLocation: LA };
    const a = article({
      title: 'Ukraine reports new strikes overnight, dozens injured',
      snippet: 'Officials in Kyiv confirmed the strikes on residential buildings.',
    });
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
