import type { Channel } from '../../ipc-contract';
import { api } from './api';

/** A single, shared client-side cache of the channel list, replacing what used to be N independent
 * fetches (useChannels was called at ~10 sites; the web build's Home page alone mounted 3 of them
 * at once). Every consumer subscribes to the SAME data instead of holding its own copy:
 *
 *   - One `getChannels()` call serves every subscriber, not one per subscriber per event.
 *   - Warm across navigation — Home -> a channel -> Home no longer refetches and flashes empty,
 *     because the store isn't tied to any one component's lifetime.
 *   - `poll()` in api.ts (web only) can hand its already-fetched payload straight in, instead of
 *     firing a synthetic event that makes every subscriber fetch the same thing again.
 *   - `mutate()` gives every write an optimistic, synchronous local update instead of waiting for
 *     the next poll tick (up to 20s on the web build) to reflect a change that already succeeded.
 *
 * Module-level rather than React context on purpose: a context provider would need this exact same
 * dedupe/subscribe logic living inside it anyway, and a context can't be reached from api.ts's poll
 * loop, which isn't React at all. This also matches the module-singleton shape api.ts already uses
 * for its own listener set. */

let cache: Channel[] | null = null; // null = never loaded yet
let inFlight: Promise<Channel[]> | null = null;
const subs = new Set<() => void>();

function notify(): void {
  for (const fn of subs) fn();
}

/** The current channel list, or null if nothing has loaded yet. Synchronous — for a subscriber's
 * initial render, so a warm cache paints on the very first frame instead of a guaranteed empty one. */
export function getSnapshot(): Channel[] | null {
  return cache;
}

export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Swap in a freshly-fetched list, but only actually update (and notify) if it's genuinely
 * different from what's cached. This is the load-bearing detail: without it, every 20s poll tick
 * would mint a new array identity even when nothing changed, and identity-sensitive dependents
 * (useChannelCounts' reload callback, in particular) would re-fire their own fetches for no reason
 * every single tick. Returns whether anything actually changed, so callers (the poll loop) can
 * decide whether downstream events are worth emitting at all. */
export function ingest(next: Channel[]): boolean {
  const changed = JSON.stringify(next) !== JSON.stringify(cache);
  if (changed) {
    cache = next;
    notify();
  }
  return changed;
}

/** Fetch the current channel list and ingest it. Concurrent callers share one in-flight request
 * rather than each firing their own — this is what collapses Home's several simultaneous
 * useChannels() mounts into a single network call. */
export function refresh(): Promise<Channel[]> {
  if (inFlight) return inFlight;
  inFlight = api
    .getChannels()
    .then((next) => {
      ingest(next);
      return next;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Apply a local patch immediately (optimistic — before the network call even starts), fire the
 * real request, and on failure roll back to exactly what was cached before, then resync with the
 * server so the UI can never drift from the truth. On success, `refresh()` is NOT called here —
 * the mutation's own response already reflects the new state via the optimistic patch, and
 * api.ts's revalidateNow() (called by every mutation call site) confirms it shortly after rather
 * than this function assuming the patch was correct. */
export async function mutate<T>(
  optimistic: (prev: Channel[]) => Channel[],
  call: () => Promise<T>
): Promise<T> {
  const before = cache;
  if (before !== null) {
    cache = optimistic(before);
    notify();
  }
  try {
    return await call();
  } catch (err) {
    // Roll back to exactly what was there before this optimistic patch, then ask the server for
    // the truth — the failure might mean the local patch was wrong, or might mean something ELSE
    // changed server-side in the meantime; either way, resyncing is safer than trusting either the
    // optimistic guess or the rolled-back snapshot.
    cache = before;
    notify();
    void refresh();
    throw err;
  }
}
