export function formatDateHeader(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** "resets in 4h 12m" — computed client-side from a future ISO timestamp so it stays correct
 * without needing the server's clock. Used for the guest daily-refresh-limit message (see
 * RateLimitError in src/services/api.ts); already elapsed or malformed input reads as "shortly",
 * since a negative/garbage duration is more confusing shown literally than rounded down to nothing. */
export function formatTimeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'shortly';
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins === 0 ? `${hrs}h` : `${hrs}h ${remMins}m`;
}
