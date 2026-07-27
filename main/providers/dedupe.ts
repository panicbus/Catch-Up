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

/** Function words that carry no identity — the bits that get shuffled when the same wire story is
 * re-headlined ("…arrives **in** stellar debut" vs "…**on** stellar debut"). Shared with the
 * relevance scorer. Kept here because dedupe.ts is the lowest-level (crypto-only) module, so both
 * channelProfiles.ts and relevance.ts can import it without an import cycle. */
export const STOPWORDS = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor', 'so', 'yet',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'as', 'by', 'from', 'into', 'onto', 'over', 'under', 'after', 'before', 'about', 'up', 'out',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'this', 'that', 'these', 'those', 'it', 'its',
]);

/** A stricter dedup key than normalizeTitle: drops STOPWORDS so headlines that differ only by a
 * filler word collapse together, while PRESERVING word order so genuinely different sentences with
 * the same words don't ("man bites dog" ≠ "dog bites man"). Falls back to the full normalized title
 * if stripping leaves nothing, so all-stopword titles aren't all fused into one empty key. */
export function titleDedupeKey(title: string): string {
  const normalized = normalizeTitle(title);
  const kept = normalized.split(' ').filter((w) => w && !STOPWORDS.has(w));
  return kept.length ? kept.join(' ') : normalized;
}
