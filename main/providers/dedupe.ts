import crypto from 'crypto';

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'];

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    const pathname = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
    return `${u.origin}${pathname}${u.search}`;
  } catch {
    return raw;
  }
}

export function articleId(url: string): string {
  return 'art_' + crypto.createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 12);
}

/** Wire/syndicated stories (AP, etc.) run verbatim across dozens of outlets under different URLs
 * and different `source` values — URL-based dedupe alone lets every one of them through. Collapsing
 * whitespace/punctuation/case on the headline catches those near-identical republications. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
