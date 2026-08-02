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
        <input
          className="password-gate__input"
          type="password"
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
        {error && <p className="password-gate__error">{error}</p>}
        <Button variant="primary" onClick={() => void submit()} disabled={submitting || !input.trim()}>
          {submitting ? 'Checking…' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
