/** Shared "is this URL safe to have the server fetch" gate — extracted from server/reader/fetchPage.ts
 * so it has exactly one implementation instead of two copies drifting apart. Two callers, two
 * different trust levels for the URL, both documented here rather than left implicit:
 *
 *   - server/reader/fetchPage.ts: the URL is never user-supplied directly — it's a `url` column read
 *     from a DB row a configured news provider already wrote. The "point the server at an internal
 *     address" attack is closed by that alone; this is defense-in-depth on top of it.
 *   - server/customSources/*: the URL IS what a signed-in user typed into a text field, both when
 *     they add a source and on every recurring poll afterward. This is the real, live case these
 *     checks exist for, not just a hardening exercise — a blocked-host check here is the only thing
 *     standing between "paste a URL" and "make the server request an internal address."
 *
 * Explicitly NOT DNS-rebinding-proof either way (that needs a pinned-IP fetch dispatcher, e.g. a
 * custom undici Agent with a fixed `lookup`, so the IP actually connected to is the one validated,
 * not whatever the hostname resolves to a second time at request time). Accepted for both callers:
 * this is a personal app with a small, known set of humans typing in URLs, not a public multi-tenant
 * service, and the blocked-host checks below already close the far more common "literally type
 * localhost or a metadata IP" case. Said here rather than implied. */

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

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost') return true;
  if (PRIVATE_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (isPrivateIPv4(host)) return true;
  // IPv6 loopback / unique-local — literal-address checks only, same reasoning as the IPv4 case.
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return false;
}

/** Parses and validates in one step — http(s) only, host not on the blocked list. Returns null for
 * anything that fails either check, so callers never have to remember to check both. */
export function checkUrl(raw: string): URL | null {
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
