import { useEffect, useRef, useState } from 'react';
import { Button } from '../common/Button';
import { EMAIL_PATTERN } from '../../utils/email';
// Reuses digest-setting__field/__input/__error/__field-* classes for the input/button/error
// styling — same look as every other field in DigestSetting, so importing its sheet here rather
// than duplicating those rules, even though DigestSetting.tsx (the only current renderer of this
// component) already loads it too.
import './DigestSetting.css';
import './DigestEmailField.css';

// How long "Email saved" stays up before the field collapses into the summary view — same hold
// time as AppInfoButton's "Link copied" confirmation, for a consistent feel across the app.
const CONFIRM_HOLD_MS = 2000;

interface DigestEmailFieldProps {
  /** settings.digestEmailOverride, straight from the parent — this component never re-fetches its
   * own copy (ChannelChecklist alongside it in DigestSetting takes channels the same way). */
  email: string | null;
  onSave: (email: string) => void;
  onRemove: () => void;
}

type Phase = 'editing' | 'justSaved' | 'collapsed';

/** The digest email field, self-collapsing once a value is actually saved: starts open with an
 * empty box until there's something to show, then swaps to a plain "Digest email: x" line with a
 * Remove link, rather than leaving a live, always-editable input sitting there with no feedback
 * that anything actually happened. Reopening (via Remove) starts from an empty box again, not the
 * old value pre-filled — entering a fresh address is the whole flow, there's no in-place edit. */
export function DigestEmailField({ email, onSave, onRemove }: DigestEmailFieldProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Only ever read once, at mount — see this file's own doc comment: the parent only renders this
  // component at all once settings.digestEnabled is already the real, loaded value (never the
  // FALLBACK's false), so `email` here is never a stale pre-load guess the way LocationSetting's
  // initial state can be.
  const [phase, setPhase] = useState<Phase>(() => (email ? 'collapsed' : 'editing'));
  const collapseTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    };
  }, []);

  const handleChange = (value: string) => {
    setDraft(value);
    if (error) setError(null);
    // Typing again while the confirmation is still up cancels the pending collapse — otherwise a
    // user composing a second, replacement address mid-hold would watch it collapse back to the
    // FIRST one a moment later, out from under them.
    if (phase === 'justSaved') {
      if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
      setPhase('editing');
    }
  };

  const save = () => {
    const trimmed = draft.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError("That doesn't look like a valid email address.");
      return;
    }
    setError(null);
    onSave(trimmed);
    setPhase('justSaved');
    collapseTimer.current = window.setTimeout(() => setPhase('collapsed'), CONFIRM_HOLD_MS);
  };

  const remove = () => {
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    onRemove();
    setDraft('');
    setError(null);
    setPhase('editing');
  };

  // `!email` is a belt-and-suspenders guard, not the normal path: phase already tracks this
  // correctly on its own, but a value cleared from another device/tab mid-collapse shouldn't ever
  // be able to leave this rendering an empty "Digest email: " summary line.
  const formOpen = phase !== 'collapsed' || !email;

  return (
    <div className="digest-setting__field">
      <label className="digest-setting__field-label" htmlFor="digest-email">
        Digest email address
      </label>
      <p className="digest-setting__field-hint">Where your daily digest gets sent.</p>

      <div className={`digest-email-field__panel ${formOpen ? 'digest-email-field__panel--open' : ''}`}>
        <div className="digest-email-field__panel-inner">
          <div className="digest-setting__email-row">
            <input
              id="digest-email"
              className="digest-setting__input"
              type="email"
              placeholder="you@example.com"
              value={draft}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
            />
            <Button size="sm" onClick={save} disabled={!draft.trim()}>
              Save
            </Button>
          </div>
          {error && <p className="digest-setting__error">{error}</p>}
          {phase === 'justSaved' && <p className="digest-email-field__confirm">Email saved</p>}
        </div>
      </div>

      <div className={`digest-email-field__panel ${!formOpen ? 'digest-email-field__panel--open' : ''}`}>
        <div className="digest-email-field__panel-inner">
          <p className="digest-email-field__summary">
            Digest email: <strong>{email}</strong>{' '}
            <button type="button" className="digest-email-field__remove" onClick={remove}>
              Remove.
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
