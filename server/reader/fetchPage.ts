/** Fetches a publisher's article page for extraction. A sibling to, deliberately NOT a modification
 * of, main/providers/fetchWithTimeout.ts — six providers depend on that helper's URL-only signature
 * and its own doc comment scopes it to that job. This one needs a User-Agent header, a content-type
 * gate, manual redirect handling, and a streamed byte cap, which is enough divergence that bolting
 * them onto the shared helper would make both harder to read.
 *
 * SSRF: the URL this is called with is never user-supplied directly — see server/reader/index.ts,
 * which only ever passes a `url` column read from a DB row scoped to `where: { id, channelId,
 * userId }`. That means a caller can only ever reach a URL that a configured news provider already
 * wrote into THEIR OWN rows — the "point the server at an internal address" class of attack is
 * closed by that alone. The blocked-host/protocol checks below (server/lib/urlSafety.ts, shared with
 * server/customSources/, which does have a directly-user-supplied URL to worry about) are
 * defense-in-depth on top of that, not the primary defense here. See that module's own doc comment
 * for the full reasoning, including why this isn't DNS-rebinding-proof. */

import { checkUrl } from '../lib/urlSafety';

const TIMEOUT_MS = 8_000;
// Was 1.5MB — confirmed live after shipping that real, ordinary article pages (not pathological
// ones) routinely run ~2-2.1MB decompressed (techradar.com, guitarworld.com, cyclingnews.com all
// measured right around there) and were hitting this cap, accounting for a real slice of reported
// failures. Verified the actual memory cost before raising it: fetching and parsing a real 2.1MB
// page (fetch + linkedom + Readability) cost only ~18MB of RSS above baseline — on a 512MB box with
// the single-extraction mutex in index.ts ensuring nothing else runs concurrently, 3MB has wide
// margin. `content-length` is NOT what this bounds against — it reports the compressed transfer
// size; a page can look small there and still decompress to 2MB+, which is exactly what happened.
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;
const USER_AGENT =
  'Mozilla/5.0 (compatible; CatchUpReader/0.16; +https://usecatchup.app) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export type FetchPageResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; reason: 'blocked-host' | 'too-large' | 'not-html' | 'http-error' | 'timeout' | 'network'; status?: number };

/** Reads the body through a stream and aborts past MAX_BYTES rather than trusting `content-length`,
 * which is often absent on chunked responses — a publisher could otherwise stream an unbounded page
 * at us. */
async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
}

export async function fetchPage(startUrl: string): Promise<FetchPageResult> {
  let url = checkUrl(startUrl);
  if (!url) return { ok: false, reason: 'blocked-host' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return { ok: false, reason: 'timeout' };
        return { ok: false, reason: 'network' };
      }

      // Manual redirect, re-validated on every hop — the whole point of not using `redirect:
      // 'follow'` is that a compromised or malicious publisher shouldn't be able to redirect this
      // fetch into an internal address after the initial URL passed checkUrl().
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return { ok: false, reason: 'http-error' };
        const next = checkUrl(new URL(location, url).toString());
        if (!next) return { ok: false, reason: 'blocked-host' };
        url = next;
        continue;
      }

      if (!res.ok) return { ok: false, reason: 'http-error', status: res.status };

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('html')) return { ok: false, reason: 'not-html' };

      const html = await readCapped(res);
      if (html === null) return { ok: false, reason: 'too-large' };
      return { ok: true, html, finalUrl: url.toString() };
    }
    return { ok: false, reason: 'http-error' }; // too many redirects
  } finally {
    clearTimeout(timer);
  }
}
