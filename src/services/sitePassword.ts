/** Storage for the shared site password (see server/passwordGate.ts) — only relevant to the web
 * build. Kept as its own tiny module so both api.ts (attaches it to every request) and
 * PasswordGate.tsx (the entry screen that collects/validates it) share one source of truth. */

const STORAGE_KEY = 'catchup_site_password';

export function getSitePassword(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setSitePassword(password: string): void {
  localStorage.setItem(STORAGE_KEY, password);
}

export function clearSitePassword(): void {
  localStorage.removeItem(STORAGE_KEY);
}
