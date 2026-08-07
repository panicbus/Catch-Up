/** Shared "who's signed in" store — module-singleton, same shape as channelsStore.ts
 * (getSnapshot/subscribe/notify), so every component that cares (AccountMenu, AuthGate, anything
 * else later) reads the same cache instead of each holding its own copy or re-fetching
 * independently. Web build only: nothing here is imported by any code path Electron runs (see
 * AuthGate.tsx's own isWeb guard, which is what actually keeps this from ever being called on
 * desktop — this file has no such guard itself since it has nothing IN it that assumes a browser). */

import { request, post, onUnauthorized } from './api';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

// undefined = not checked yet this session; null = checked, signed out; else the signed-in user.
// The three-way split is what lets AuthGate show a loading state only until the FIRST check
// resolves, rather than flashing the sign-in screen for an instant on every reload.
let currentUser: CurrentUser | null | undefined;
const subs = new Set<() => void>();

function notify(): void {
  for (const fn of subs) fn();
}

export function getSnapshot(): CurrentUser | null | undefined {
  return currentUser;
}

export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

// Any 401, from any endpoint, means "not actually signed in" regardless of what this store
// currently believes — see api.ts's own comment on onUnauthorized for why that can happen even
// with a cookie present. Subscribed once at module load, not per-component.
onUnauthorized(() => {
  if (currentUser !== null) {
    currentUser = null;
    notify();
  }
});

/** Checks whether the browser's cookie (if any) still corresponds to a real session. Resolves to
 * the user on success; on any failure (no cookie, expired session, network error) resolves to null
 * rather than throwing — "not signed in" is an expected, ordinary outcome here, not an error. */
export async function getMe(): Promise<CurrentUser | null> {
  try {
    currentUser = await request<CurrentUser>('/auth/me');
  } catch {
    currentUser = null;
  }
  notify();
  return currentUser;
}

export async function loginWithGoogle(credential: string): Promise<CurrentUser> {
  currentUser = await post<CurrentUser>('/auth/google', { credential });
  notify();
  return currentUser;
}

export async function logout(): Promise<void> {
  // Best-effort: even if the network call fails, the user clicked Sign Out and expects to be
  // signed out locally — AuthGate reacting to the store is what actually removes their data from
  // screen, so this must not leave them looking signed-in just because one request failed.
  await post('/auth/logout').catch(() => {});
  currentUser = null;
  notify();
}
