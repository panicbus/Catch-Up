import { useEffect, useRef, useState } from 'react';
import { loginWithGoogle } from '../../services/auth';
import { loadGoogleIdentityScript } from './googleIdentity';
import { Logo } from '../Layout/Logo';
import dinerBg from '../../assets/diner-bg.png';
import './SignInScreen.css';

/** Full-screen gate, not a dismissible dialog — there is no signed-out mode of the app to fall back
 * to (every /api route requires a session), so this mirrors OnboardingWizard's weight rather than
 * Modal.tsx's overlay. Rendered by AuthGate.tsx whenever there's no current user. */
export function SignInScreen() {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      // A real, if unlikely, deployment mistake (VITE_GOOGLE_CLIENT_ID unset in Vercel) — worth a
      // specific message rather than a button that silently never appears.
      setError('Sign-in is not configured for this deployment.');
      return;
    }

    let cancelled = false;
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !window.google || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            setError(null);
            void loginWithGoogle(response.credential).catch((e: unknown) => {
              setError(e instanceof Error ? e.message : 'Could not sign in. Please try again.');
            });
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          width: 280,
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load Google Sign-In. Check your connection and reload.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="sign-in-screen">
      {/* Same diner sketch as Home/onboarding, for visual continuity with the rest of the app. */}
      <div className="sign-in-screen__bg" style={{ backgroundImage: `url("${dinerBg}")` }} aria-hidden="true" />
      <div className="sign-in-screen__card">
        <div className="sign-in-screen__header">
          <Logo size={88} />
          <h1 className="sign-in-screen__title">Welcome to Catch Up</h1>
          <p className="sign-in-screen__tagline">Sign in with Google to catch up on your news.</p>
        </div>

        <div className="sign-in-screen__button" ref={buttonRef} />
        {!ready && !error && <p className="sign-in-screen__loading">Loading sign-in…</p>}
        {error && <p className="sign-in-screen__error">{error}</p>}
      </div>
    </div>
  );
}
