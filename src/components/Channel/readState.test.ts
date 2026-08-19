import { describe, it, expect } from 'vitest';
import { isEffectivelyRead, buildUnreadKey } from './readState';

describe('isEffectivelyRead', () => {
  it('is true when the server has confirmed it read', () => {
    expect(isEffectivelyRead(true, 'a1', new Set())).toBe(true);
  });

  it('is true when marked read-in-place locally, even before the server confirms it', () => {
    // The exact regression this exists to guard: display must not wait on server confirmation,
    // which can lag up to ~20s behind — see this module's own doc comment.
    expect(isEffectivelyRead(false, 'a1', new Set(['a1']))).toBe(true);
  });

  it('is false when neither the server nor the local session knows it as read', () => {
    expect(isEffectivelyRead(false, 'a1', new Set(['a2']))).toBe(false);
  });

  it('is false for an empty keepVisible set and an unconfirmed read', () => {
    expect(isEffectivelyRead(false, 'a1', new Set())).toBe(false);
  });
});

describe('buildUnreadKey', () => {
  it('is order-independent', () => {
    // The exact regression this exists to guard: a relevance-mode reorder with no membership
    // change must not look like a change.
    expect(buildUnreadKey(['b', 'a', 'c'])).toBe(buildUnreadKey(['c', 'a', 'b']));
  });

  it('changes when membership actually changes', () => {
    expect(buildUnreadKey(['a', 'b'])).not.toBe(buildUnreadKey(['a', 'b', 'c']));
  });

  it('produces a stable, sorted, pipe-joined string', () => {
    expect(buildUnreadKey(['b', 'a'])).toBe('a|b');
  });

  it('is empty for an empty input', () => {
    expect(buildUnreadKey([])).toBe('');
  });
});
