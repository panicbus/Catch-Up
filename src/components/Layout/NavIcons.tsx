/** Shared between Sidebar (desktop) and BottomNav (mobile) so the two navs can't drift apart on
 * iconography. AboutIcon stays in Sidebar.tsx — About has no mobile nav entry (see BottomNav.tsx). */

export function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11l9-8 9 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PoolIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** `filled` is only meaningful where the caller has a real "active/selected" state to represent
 * (BottomNav) — an open path like HomeIcon/PoolIcon has no sensible filled form, so only the two
 * icons built from a single closed shape (a bookmark ribbon, a gear) support it. Everywhere else
 * this defaults to the plain outline, unchanged. */
export function BookmarkIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SettingsIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" fill={filled ? 'currentColor' : 'none'} />
      <path
        d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.6 1z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  );
}
