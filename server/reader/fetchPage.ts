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
 * closed by that alone. Everything below is defense-in-depth on top of that, not the primary
 * defense. It is explicitly NOT DNS-rebinding-proof (that needs a pinned-IP fetch dispatcher, e.g.
 * a custom undici Agent with a fixed `lookup`); given the URL space here is a curated set written
 * by four fixed news APIs into a personal app's own database, building that is disproportionate to
 * the actual risk. Said here rather than implied. */

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const USER_AGENT =
  'Mozilla/5.0 (compatible; CatchUpReader/0.16; +https://usecatchup.app) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export type FetchPageResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; reason: 'blocked-host' | 'too-large' | 'not-html' | 'http-error' | 'timeout' | 'network' };

const PRIVATE_HOSTNAME_SUFFIXES = ['.local', '.internal', '.localhost'];

/** Cheap, deliberately conservative IPv4-literal private-range check — string/number math only, no
 * DNS resolution (resolving the hostname ourselves and pinning to that IP is the DNS-rebinding-proof
 * version this isn't attempting, see the file comment above). */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata, 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true;
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost') return true;
  if (PRIVATE_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (isPrivateIPv4(host)) return true;
  // IPv6 loopback / unique-local — literal-address checks only, same reasoning as the IPv4 case.
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return false;
}

function checkUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (isBlockedHost(u.hostname)) return null;
  return u;
}

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

      if (!res.ok) return { ok: false, reason: 'http-error' };

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
