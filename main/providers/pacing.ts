/** Per-provider minimum spacing between actual outbound requests — independent of how often the
 * rest of the app calls a provider. A refresh cycle fans out many queries (one per channel, plus
 * staggered subchannels) only 300ms apart (see refreshAgent's PROVIDER_PACING_MS), which is fine
 * for providers with generous per-minute limits but is a burst for one that isn't. Providers with
 * a tight per-minute cap should call throttle() as the first thing in fetchArticles so their calls
 * self-space out no matter how eagerly they're invoked. */
const lastCallAt = new Map<string, number>();

export async function throttle(providerId: string, minIntervalMs: number): Promise<void> {
  const last = lastCallAt.get(providerId);
  const now = Date.now();
  const wait = last === undefined ? 0 : last + minIntervalMs - now;
  // Reserve the slot before waiting, not after — otherwise two calls arriving close together both
  // read the same stale `last` and wait the same amount, landing at the same time instead of
  // queuing behind each other.
  lastCallAt.set(providerId, now + Math.max(wait, 0));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
