/** Static list of source domains known to paywall most/all content. Not exhaustive — a badge, not a filter. */
const PAYWALLED_DOMAINS = new Set([
  'nytimes.com',
  'wsj.com',
  'ft.com',
  'washingtonpost.com',
  'newyorker.com',
  'economist.com',
  'bloomberg.com',
  'theathletic.com',
  'wired.com',
  'businessinsider.com',
]);

export function isPaywalledDomain(hostname: string): boolean {
  const host = hostname.replace(/^www\./, '');
  if (PAYWALLED_DOMAINS.has(host)) return true;
  for (const d of PAYWALLED_DOMAINS) {
    if (host.endsWith(`.${d}`)) return true;
  }
  return false;
}
