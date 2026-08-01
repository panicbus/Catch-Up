import { useEffect, useState, type ReactNode } from 'react';
import { getSitePassword, setSitePassword } from '../services/sitePassword';
import { Button } from './common/Button';
import './PasswordGate.css';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api`;

async function validate(password: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/ping`, { headers: { 'X-Site-Password': password } });
  return res.ok;
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

  useEffect(() => {
    const stored = getSitePassword();
    if (!stored) {
      setChecking(false);
      return;
    }
    void validate(stored).then((ok) => {
      setUnlocked(ok);
      setChecking(false);
    });
  }, []);

  const submit = async () => {
    if (submitting || !input.trim()) return;
    setSubmitting(true);
    setError(null);
    const ok = await validate(input.trim());
    setSubmitting(false);
    if (ok) {
      setSitePassword(input.trim());
      setUnlocked(true);
    } else {
      setError('That password is incorrect.');
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
