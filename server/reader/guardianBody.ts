/** Tier 1: The Guardian's Content API returns full licensed body text for a simple `show-fields`
 * param — verified live with their public `test` key (show-fields=body,byline,wordcount returned
 * 8,264 chars of HTML). Zero scraping, near-100% success for anything published on theguardian.com.
 * Read-time only, not folded into the ingest fetch in main/providers/guardian.ts: that runs on
 * every refresh across every search, and multiplying its payload by ~8KB/article for content that's
 * mostly never opened isn't worth it. This only ever fires when a user actually opens a story. */

import { fetchWithTimeout } from '../../main/providers/fetchWithTimeout';
import { isCoolingDown, isHardFailureStatus, startCooldown, RATE_LIMIT_COOLDOWN_MS } from '../../main/providers/cooldown';
import { blocksFromHtmlFragment } from './extract';
import type { ReaderBlock } from '../../ipc-contract';

// A distinct cooldown id from main/providers/guardian.ts's 'guardian' — a reader-path 429 must not
// blind the refresh loop's own Guardian calls, and vice versa; they share a daily quota but fail
// independently in this app's model.
const COOLDOWN_ID = 'guardian-reader';

interface GuardianItemResponse {
  response?: {
    status?: string;
    content?: {
      webTitle?: string;
      fields?: { body?: string; byline?: string; wordcount?: string };
    };
  };
}

export interface GuardianTierResult {
  blocks: ReaderBlock[];
  byline: string | null;
  wordCount: number;
  truncated: boolean;
}

/** The Guardian's Content API item path is exactly the URL path with the domain stripped —
 * confirmed live against real article URLs. Returns null for anything that isn't a
 * theguardian.com URL, so callers can try this unconditionally without checking the domain first. */
function toItemPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('theguardian.com')) return null;
    const path = u.pathname.replace(/^\/+/, '');
    return path || null;
  } catch {
    return null;
  }
}

/** Returns null on ANY failure (not configured, cooling down, non-200, a 200 with a JSON-level
 * error — confirmed live that some items 403 with an error body despite the request succeeding at
 * the transport level, e.g. live-blog/interactive content not available on this key's tier) so the
 * caller can fall straight through to Tier 2 uniformly, exactly like every main/providers/* source
 * already does for its own fetch failures. */
export async function tryGuardianBody(url: string): Promise<GuardianTierResult | null> {
  const path = toItemPath(url);
  if (!path) return null;
  const key = process.env.GUARDIAN_API_KEY?.trim();
  if (!key) return null;
  if (isCoolingDown(COOLDOWN_ID)) return null;

  try {
    const apiUrl = `https://content.guardianapis.com/${path}?api-key=${key}&show-fields=body,byline,wordcount`;
    const res = await fetchWithTimeout(apiUrl, 8_000);
    if (!res.ok) {
      if (isHardFailureStatus(res.status)) startCooldown(COOLDOWN_ID, RATE_LIMIT_COOLDOWN_MS);
      return null;
    }
    const data = (await res.json()) as GuardianItemResponse;
    if (data.response?.status !== 'ok') return null;
    const body = data.response.content?.fields?.body;
    if (!body || body.length < 200) return null;

    const { blocks, truncated } = blocksFromHtmlFragment(body, url);
    const wordCount = Number(data.response.content?.fields?.wordcount) || 0;
    return { blocks, byline: data.response.content?.fields?.byline || null, wordCount, truncated };
  } catch (e) {
    console.warn('[reader/guardian] fetch error', e);
    return null;
  }
}
