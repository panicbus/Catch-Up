import { describe, it, expect } from 'vitest';
import { pickSurvivingAnchor, hasOrderChanged, type AnchorCandidate } from './scrollAnchor';

const card = (id: string, top: number, bottom: number): AnchorCandidate => ({ id, top, bottom });

describe('pickSurvivingAnchor', () => {
  it('picks the first candidate at or below the visible top edge', () => {
    const candidates = [card('a', -50, -10), card('b', 20, 80), card('c', 90, 150)];
    // 'a' is fully scrolled past above (bottom -10 <= visibleTop 0); 'b' is the first one whose
    // bottom is below the fold.
    expect(pickSurvivingAnchor(candidates, 0, new Set())?.id).toBe('b');
  });

  it('skips a vanishing candidate even if it would otherwise be the pick', () => {
    const candidates = [card('a', -50, -10), card('b', 20, 80), card('c', 90, 150)];
    expect(pickSurvivingAnchor(candidates, 0, new Set(['b']))?.id).toBe('c');
  });

  it('returns null when every surviving candidate has already scrolled past the top', () => {
    const candidates = [card('a', -80, -20), card('b', -40, -5)];
    expect(pickSurvivingAnchor(candidates, 0, new Set())).toBeNull();
  });

  it('returns null when nothing survives at all (everything visible is vanishing)', () => {
    const candidates = [card('a', 10, 60), card('b', 70, 120)];
    expect(pickSurvivingAnchor(candidates, 0, new Set(['a', 'b']))).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(pickSurvivingAnchor([], 0, new Set())).toBeNull();
  });

  it('treats a card straddling the visible top edge as surviving (bottom strictly greater than visibleTop)', () => {
    const candidates = [card('a', -10, 0), card('b', -10, 1)];
    // 'a' bottom === visibleTop exactly → not selected; 'b' bottom just past it → selected.
    expect(pickSurvivingAnchor(candidates, 0, new Set())?.id).toBe('b');
  });

  it('an empty vanishing set (a pure insertion or reorder, nothing removed) still picks the topmost candidate', () => {
    // NewsFeed passes an empty vanishingIds set whenever nothing was actually removed — this
    // function doesn't need to know or care whether that's because nothing changed, something was
    // inserted, or the list was reordered; it just anchors to whatever's topmost either way.
    const candidates = [card('a', -50, -10), card('b', 20, 80), card('c', 90, 150)];
    expect(pickSurvivingAnchor(candidates, 0, new Set())?.id).toBe('b');
  });
});

describe('hasOrderChanged', () => {
  it('is false when the sequence is identical', () => {
    expect(hasOrderChanged(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(false);
  });

  it('is false for two empty lists', () => {
    expect(hasOrderChanged([], [])).toBe(false);
  });

  it('is true for a removal', () => {
    expect(hasOrderChanged(['a', 'b', 'c'], ['a', 'c'])).toBe(true);
  });

  it('is true for an insertion, even at the end (same relative order otherwise)', () => {
    expect(hasOrderChanged(['a', 'b'], ['a', 'b', 'c'])).toBe(true);
  });

  it('is true for a pure reorder with IDENTICAL membership — the case a Set comparison would miss', () => {
    expect(hasOrderChanged(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(true);
  });

  it('is true when a new story is inserted at the top, shifting everything else down a slot', () => {
    expect(hasOrderChanged(['a', 'b', 'c'], ['new', 'a', 'b', 'c'])).toBe(true);
  });
});
