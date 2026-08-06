import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import './ApiKeyModal.css';

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

interface ApiKeyModalProps {
  /** e.g. "Gemini" or "Groq" — used in the title, placeholder and note. */
  providerName: string;
  /** Sentence explaining what AI filtering does and why this provider (its free tier, etc). */
  lead: string;
  /** Where to mint a free key. */
  keyUrl: string;
  keyUrlLabel: string;
  /** Last 4 characters of the key already on file, if any — the full key never reaches the
   * renderer (see ipc-contract.ts's AiConfig doc), so this is all there is to show for it. Presence
   * of this prop is what puts the modal in "replace" mode. */
  existingKeyLast4?: string | null;
  /** Validates + stores the key; resolves ok:false with a message when the key is rejected. */
  onSave: (key: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  /** Called after a key is accepted, so the parent can reflect the now-on state. */
  onSaved: () => void;
}

/** Collects an API key for whichever cloud provider (Gemini or Groq) the user just picked. Also
 * doubles as the "Replace" flow when a key is already saved (existingKeyLast4 set): shows a masked
 * placeholder for the key on file — with an eye toggle that reveals just its last 4 characters,
 * never the full secret — above the field for pasting a new one. The key is validated (one tiny live
 * call) before it's stored, so a bad or quota-limited key is caught here rather than silently
 * ignored. */
export function ApiKeyModal({
  providerName,
  lead,
  keyUrl,
  keyUrlLabel,
  existingKeyLast4,
  onSave,
  onClose,
  onSaved,
}: ApiKeyModalProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const isReplace = !!existingKeyLast4;

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await onSave(key);
    setSaving(false);
    if (result.ok) {
      onSaved();
      onClose();
    } else {
      setError(result.error ?? 'That key didn’t work. Please try again.');
    }
  };

  return (
    <Modal
      title={isReplace ? `Replace your ${providerName} API key` : `Use ${providerName} for AI filtering`}
      onClose={onClose}
      contentClassName="api-key-modal"
    >
      <div className="modal__body">
        {isReplace && (
          <div className="api-key-modal__current">
            <span className="api-key-modal__current-label">Current key</span>
            <span className="api-key-modal__current-value">
              {revealed ? `${'•'.repeat(8)}${existingKeyLast4}` : '•'.repeat(12)}
            </span>
            <button
              type="button"
              className="api-key-modal__reveal"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? 'Hide key' : 'Reveal last 4 characters'}
              title={revealed ? 'Hide' : 'Reveal last 4 characters'}
            >
              <EyeIcon open={revealed} />
            </button>
          </div>
        )}
        <p className="api-key-modal__lead">{lead}</p>
        <ol className="api-key-modal__steps">
          <li>
            Open{' '}
            <a href={keyUrl} target="_blank" rel="noreferrer">
              {keyUrlLabel}
            </a>{' '}
            and sign in.
          </li>
          <li>Create {isReplace ? 'a new' : 'an'} API key and copy it.</li>
          <li>Paste it below.</li>
        </ol>
        <input
          className="api-key-modal__input"
          type="password"
          placeholder={isReplace ? `Paste your new ${providerName} API key` : `Paste your ${providerName} API key`}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && key.trim()) void submit();
          }}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
        {error && <p className="api-key-modal__error">{error}</p>}
        <p className="api-key-modal__note">
          Your key is stored locally on this device and used only to filter your stories.
        </p>
      </div>
      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={saving || key.trim().length === 0}>
          {saving ? 'Checking…' : isReplace ? 'Save & replace' : 'Save & turn on'}
        </Button>
      </div>
    </Modal>
  );
}
