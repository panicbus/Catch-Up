/** Domains known not to work with the reader view's fetch-and-extract approach — confirmed live
 * while building this (see the plan notes): Reuters and WSJ return 401 to a plain server-side
 * fetch, Bloomberg returns 403 "Are you a robot", Washington Post refuses the connection outright.
 * Skipping the fetch for these avoids burning a request, the mutex slot, and the timeout on an
 * attempt that's already known to fail.
 *
 * Deliberately a SEPARATE list from main/providers/paywallDomains.ts, not merged into it — that
 * one drives the visible PaywallBadge on every card, and Reuters/WSJ/Bloomberg are already on it
 * for that (correct) reason. news.google.com is NOT paywalled but doesn't belong there either; it's
 * blocked here for an entirely different reason (see index.ts's Gate C). Keeping them apart means
 * adding a reader-only block never mislabels a card as paywalled, and vice versa. */
const READER_BLOCKED_DOMAINS = new Set([
  'reuters.com',
  'wsj.com',
  'bloomberg.com',
  'washingtonpost.com',
]);

export function isReaderBlockedDomain(hostname: string): boolean {
  const host = hostname.replace(/^www\./, '');
  if (READER_BLOCKED_DOMAINS.has(host)) return true;
  for (const d of READER_BLOCKED_DOMAINS) {
    if (host.endsWith(`.${d}`)) return true;
  }
  return false;
}
