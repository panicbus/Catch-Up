/** Per-provider cooldown so a hard failure (bad key, exhausted quota — 401/403/429) logs once and
 * then skips silently, instead of re-hitting the network and re-warning on every single
 * channel/subchannel query until the process restarts. A single refresh cycle can fan out into a
 * dozen-plus queries per provider (one per subchannel), so an un-throttled failure mode turns into
 * console spam — and wasted requests — fast. */
/** Long enough to stop the spam for the rest of a session; short enough to recover automatically
 * within the same day once a quota resets or a key gets fixed, without needing an app restart. */
export const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

/** Status codes that mean "this key/quota is bad right now," not "try again next request." */
const HARD_FAILURE_STATUSES = new Set([401, 403, 429]);

export function isHardFailureStatus(status: number): boolean {
  return HARD_FAILURE_STATUSES.has(status);
}

const cooldowns = new Map<string, number>();

export function isCoolingDown(providerId: string): boolean {
  const until = cooldowns.get(providerId);
  return until !== undefined && Date.now() < until;
}

export function startCooldown(providerId: string, durationMs: number): void {
  cooldowns.set(providerId, Date.now() + durationMs);
}
