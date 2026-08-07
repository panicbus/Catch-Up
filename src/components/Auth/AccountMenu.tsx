import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { logout } from '../../services/auth';
import './AccountMenu.css';

// Structurally unreachable on desktop already — AppShell.tsx only mounts this inside AuthGate,
// which skips itself entirely there (see AuthGate.tsx). Guarded again here anyway, matching this
// codebase's existing belt-and-suspenders instinct for platform checks (e.g. revalidateNow() in
// api.ts guards itself the same way even though its only caller is already web-only).
const isWeb = typeof window !== 'undefined' && !window.api;

/** The corner avatar + dropdown — same trigger/outside-click/role="menu" shape as
 * OverflowMenu.tsx, this codebase's established pattern for a small anchored menu. Rendered once by
 * AppShell.tsx (inside AuthGate, outside OnboardingGate — see that file), so it's real shared chrome
 * on every route at both breakpoints, not the old route-scoped "Sign in" stub it replaces. */
export function AccountMenu() {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Not `undefined` (still loading) and not `null` (signed out) — AuthGate only ever mounts this
  // once a real user exists, but the type is still nullable, so this is a defensive, not load-
  // bearing, early-out.
  if (!isWeb || !user) return null;

  const initial = (user.displayName ?? user.email).charAt(0).toUpperCase();

  return (
    <div className="account-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="account-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user.avatarUrl ? (
          <img className="account-menu__avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="account-menu__avatar account-menu__avatar--fallback">{initial}</span>
        )}
      </button>
      {open && (
        <div className="account-menu__menu" role="menu">
          <div className="account-menu__identity">
            {user.displayName && <div className="account-menu__name">{user.displayName}</div>}
            <div className="account-menu__email">{user.email}</div>
          </div>
          <div className="account-menu__divider" />
          <button
            type="button"
            role="menuitem"
            className="account-menu__item"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
