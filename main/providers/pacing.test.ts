import { describe, it, expect, vi, afterEach } from 'vitest';
import { tryReserve } from './pacing';

// tryReserve is one of the few genuinely pure, timing-dependent things in this codebase — a real
// unit test with fake timers proves the window logic exactly, where an end-to-end refresh could
// only ever prove it indirectly (and slowly).
//
// Each test uses its own provider id: the reservation map is module-level (deliberately — the whole
// point is spacing across every call site in the process), so reusing an id would leak state
// between tests.

afterEach(() => {
  vi.useRealTimers();
});

describe('tryReserve', () => {
  it('allows the first call for a provider', () => {
    expect(tryReserve('first-call', 25_000)).toBe(true);
  });

  it('refuses a second call inside the interval, and never waits', () => {
    vi.useFakeTimers();
    expect(tryReserve('inside-window', 25_000)).toBe(true);

    // Not merely "returns false" — it must return SYNCHRONOUSLY. The old implementation returned a
    // promise that resolved 25s later, which is the exact behavior that made every refresh slow.
    vi.advanceTimersByTime(24_999);
    expect(tryReserve('inside-window', 25_000)).toBe(false);
  });

  it('allows the next call once the interval has fully elapsed', () => {
    vi.useFakeTimers();
    expect(tryReserve('after-window', 25_000)).toBe(true);
    vi.advanceTimersByTime(25_000);
    expect(tryReserve('after-window', 25_000)).toBe(true);
  });

  it('does not reserve a slot when it refuses', () => {
    // A refused call must leave the existing reservation untouched. If a refusal pushed the window
    // forward, a busy refresh would starve the provider indefinitely — every attempt resetting the
    // clock so the interval never actually elapses.
    vi.useFakeTimers();
    expect(tryReserve('no-starve', 10_000)).toBe(true);

    vi.advanceTimersByTime(9_000);
    expect(tryReserve('no-starve', 10_000)).toBe(false);

    // 1s more takes us to 10s past the ORIGINAL reservation, so this must succeed.
    vi.advanceTimersByTime(1_000);
    expect(tryReserve('no-starve', 10_000)).toBe(true);
  });

  it('tracks each provider independently', () => {
    expect(tryReserve('provider-a', 25_000)).toBe(true);
    expect(tryReserve('provider-b', 25_000)).toBe(true);
    expect(tryReserve('provider-a', 25_000)).toBe(false);
  });
});
