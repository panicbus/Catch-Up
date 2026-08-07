import { useEffect, useState, type ReactNode } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { getMe } from '../../services/auth';
import { ColdStartNotice } from '../common/ColdStartNotice';
import { SignInScreen } from './SignInScreen';

// Same delay, same reasoning as OnboardingGate.tsx's identical constant: getMe() is now the very
// first network call the web app makes, and it normally resolves in well under a second. Only show
// the notice once a wait has gone on long enough to plausibly be Render's free-tier cold start
// (~20-30s after ~15 minutes idle) — a fast/warm backend should never flash it.
const COLD_START_NOTICE_DELAY_MS = 2500;

interface AuthGateProps {
  children: ReactNode;
}

// The desktop build has no concept of signing in at all — it's a single local install with no
// server, no account, nothing to authenticate. This is the ONE guard that makes that true: it's
// evaluated before any hook below runs a network call, so Electron never touches src/services/
// auth.ts's fetch path, never renders SignInScreen/AccountMenu, and behaves exactly as it always
// has. Same isWeb check as OnboardingGate.tsx and main.tsx (see either for why it's repeated inline
// rather than imported — no shared isWeb() utility exists in this codebase).
const isWeb = typeof window !== 'undefined' && !window.api;

/** Gates the whole web app on being signed in — every /api route now requires a real session (see
 * server/auth.ts), so there is no meaningful signed-out experience to show instead of this. Mounted
 * in AppShell.tsx, wrapping OnboardingGate: auth has to resolve BEFORE onboarding, since
 * OnboardingGate's own first call (getOnboardingStatus) now needs a session to succeed at all. */
export function AuthGate({ children }: AuthGateProps) {
  if (!isWeb) return <>{children}</>;
  return <WebAuthGate>{children}</WebAuthGate>;
}

// Split into its own component (rather than an early return inside one function) so the hooks below
// are never called on desktop at all — conditionally skipping hooks in one component body would
// violate the rules of hooks the moment `isWeb` differs between renders, which it never does in
// practice, but this way there's no rule being bent to make that true.
function WebAuthGate({ children }: AuthGateProps) {
  const user = useCurrentUser();
  const [showColdStartNotice, setShowColdStartNotice] = useState(false);

  useEffect(() => {
    void getMe();
  }, []);

  useEffect(() => {
    if (user !== undefined) return;
    const timer = window.setTimeout(() => setShowColdStartNotice(true), COLD_START_NOTICE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [user]);

  // undefined: getMe() hasn't resolved yet this session.
  if (user === undefined) return showColdStartNotice ? <ColdStartNotice /> : null;
  if (user === null) return <SignInScreen />;
  return <>{children}</>;
}
