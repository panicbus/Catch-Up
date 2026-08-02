import { useEffect, useState, type ReactNode } from 'react';
import { getSitePassword, setSitePassword } from '../services/sitePassword';
import { Button } from './common/Button';
import './PasswordGate.css';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api`;

type ValidateResult = 'ok' | 'incorrect' | 'rate-limited' | 'unavailable';

async function validate(password: string): Promise<ValidateResult> {
  try {
    const res = await fetch(`${API_BASE}/ping`, { headers: { 'X-Site-Password': password } });
    if (res.ok) return 'ok';
    // 429 must NOT be reported as a wrong password — after too many failed attempts the gate
    // blocks even the correct one for a while, and saying "incorrect" there sends someone hunting
    // for a password problem that doesn't exist.
    if (res.status === 429) return 'rate-limited';
    if (res.status === 401) return 'incorrect';
    return 'unavailable';
  } catch {
    return 'unavailable'; // offline, or the server is still waking from idle
  }
}

const MESSAGES: Record<Exclude<ValidateResult, 'ok'>, string> = {
  incorrect: 'That password is incorrect.',
  'rate-limited': 'Too many incorrect attempts. Please wait a few minutes and try again.',
  unavailable: 'Can’t reach the server right now. It may be waking up — try again in a moment.',
};

// Inline SVGs to match the rest of the app's icons (see common/PauseChannelControl.tsx) — no icon
// library is used anywhere in this codebase.
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/** Gates the whole web build behind one shared password (see server/passwordGate.ts) — there's no
 * real sign-in yet, so this is a simple lock on the door rather than leaving a fully-working,
 * publicly-reachable copy of the app open to anyone with the link. Desktop build never renders
 * this at all — see main.tsx, which only mounts it for the web build. */
export function PasswordGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const stored = getSitePassword();
    if (!stored) {
      setChecking(false);
      return;
    }
    void validate(stored).then((result) => {
      // Only a genuinely wrong password should send someone back to the lock screen. A server
      // that's asleep or rate-limiting shouldn't discard a password that was working a minute ago.
      if (result === 'ok') setUnlocked(true);
      else if (result !== 'incorrect') setError(MESSAGES[result]);
      setChecking(false);
    });
  }, []);

  const submit = async () => {
    if (submitting || !input.trim()) return;
    setSubmitting(true);
    setError(null);
    const result = await validate(input.trim());
    setSubmitting(false);
    if (result === 'ok') {
      setSitePassword(input.trim());
      setUnlocked(true);
    } else {
      setError(MESSAGES[result]);
    }
  };

  if (checking) return null;
  if (unlocked) return <>{children}</>;

  return (
    <div className="password-gate">
      <div className="password-gate__card">
        <h1 className="password-gate__title">Catch Up</h1>
        <p className="password-gate__hint">This site is private for now — enter the password to continue.</p>
        <div className="password-gate__field">
          <input
            className="password-gate__input"
            type={revealed ? 'text' : 'password'}
            autoFocus
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <button
            type="button"
            className="password-gate__reveal"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            // Keeps focus in the input so toggling mid-typing doesn't interrupt.
            tabIndex={-1}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        {error && <p className="password-gate__error">{error}</p>}
        <Button variant="primary" onClick={() => void submit()} disabled={submitting || !input.trim()}>
          {submitting ? 'Checking…' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
