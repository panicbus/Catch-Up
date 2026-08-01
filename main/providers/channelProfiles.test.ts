import { describe, it, expect } from 'vitest';
import { channelProfile, sectionMatchesCategory, sectionIsForeign } from './channelProfiles';

// Baseline coverage for the channel classifier — this pre-dates the locality feature and had no
// test coverage before this suite. A regression guard, not new behavior.
describe('channelProfile', () => {
  it('classifies a broad category channel by a trigger word', () => {
    const p = channelProfile('Tech');
    expect(p.type).toBe('category');
    expect(p.category).toBe('technology');
  });

  it('never includes the ambiguous category trigger word itself as on-topic evidence', () => {
    // This is the specific bug this design prevents: "tech" must not appear in `include`, or
    // "Virginia Tech" sports stories would score as on-topic for a Tech channel.
    const p = channelProfile('Tech');
    expect(p.include).not.toContain('tech');
  });

  it('classifies a topic/entity channel (no category match) using its own name as the term', () => {
    const p = channelProfile('Phish');
    expect(p.type).toBe('topic');
    expect(p.category).toBeNull();
    expect(p.include).toEqual(['phish']);
  });

  it('classifies a multi-word topic/entity channel into multiple tokens', () => {
    const p = channelProfile('Taylor Swift');
    expect(p.type).toBe('topic');
    expect(p.include).toEqual(['taylor', 'swift']);
  });
});

describe('sectionMatchesCategory / sectionIsForeign', () => {
  it('matches a provider section against its category (case-insensitive substring)', () => {
    expect(sectionMatchesCategory('Technology', 'technology')).toBe(true);
    expect(sectionMatchesCategory('US Politics', 'politics')).toBe(true);
  });

  it('flags a section that clearly belongs to a different category', () => {
    expect(sectionIsForeign('sport', 'technology')).toBe(true);
    expect(sectionIsForeign('technology', 'technology')).toBe(false);
  });

  it('does not flag a section with no category association at all', () => {
    expect(sectionIsForeign('local-news', 'technology')).toBe(false);
  });
});
