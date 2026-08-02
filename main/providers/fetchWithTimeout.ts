/** Pure, Electron-agnostic — same portability contract as the rest of this folder.
 *
 * Every provider's fetch had NO timeout at all until this was added — confirmed as the cause of a
 * real, reported slowdown: one slow-to-respond source could leave `fetch` hanging far past any
 * point a user would ever wait, since nothing here ever gave up on it. `classifier.ts` already
 * guarded its one call this way; this brings every news-provider call to the same standard.
 *
 * On a timeout this rejects the same way a network failure already did — every provider's existing
 * try/catch already treats any thrown error identically (log a warning, return no articles for
 * that source, the refresh continues with whatever else came back) — so this needed no change to
 * any provider's error handling, only its fetch call. */

const DEFAULT_TIMEOUT_MS = 9_000;

export async function fetchWithTimeout(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
