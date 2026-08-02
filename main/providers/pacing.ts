/** Per-provider minimum spacing between actual outbound requests — independent of how often the
 * rest of the app calls a provider. A refresh cycle fans out many queries (one per channel, plus
 * staggered subchannels) only 300ms apart (see refreshAgent's PROVIDER_PACING_MS), which is fine
 * for providers with generous per-minute limits but is a burst for one that isn't.
 *
 * Providers with a tight per-minute cap should call tryReserve() as the first thing in
 * fetchArticles and bail out when it returns false — SKIP the source when its window isn't open,
 * never make the rest of the fan-out wait on it. This is deliberate: providers run together in one
 * Promise.allSettled (see registry.ts), so anything that blocks here blocks the entire refresh for
 * every other source too. A source that sits out this round costs a few stories; a source that
 * stalls costs minutes of wall clock on every single refresh.
 *
 * Being synchronous is load-bearing — the read and the write happen in one event-loop turn, so
 * there's no window for two concurrent callers to both see the same open slot and both take it. */
const lastCallAt = new Map<string, number>();

/** True (and reserves the slot) when this provider's interval has elapsed; false when it hasn't.
 * Never waits. */
export function tryReserve(providerId: string, minIntervalMs: number): boolean {
  const last = lastCallAt.get(providerId);
  const now = Date.now();
  if (last !== undefined && now < last + minIntervalMs) return false;
  lastCallAt.set(providerId, now);
  return true;
}
