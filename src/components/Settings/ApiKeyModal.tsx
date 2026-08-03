import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import './ApiKeyModal.css';

interface ApiKeyModalProps {
  /** e.g. "Gemini" or "Groq" — used in the title, placeholder and note. */
  providerName: string;
  /** Sentence explaining what AI filtering does and why this provider (its free tier, etc). */
  lead: string;
  /** Where to mint a free key. */
  keyUrl: string;
  keyUrlLabel: string;
  /** Validates + stores the key; resolves ok:false with a message when the key is rejected. */
  onSave: (key: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  /** Called after a key is accepted, so the parent can reflect the now-on state. */
  onSaved: () => void;
}

/** Collects an API key for whichever cloud provider (Gemini or Groq) the user just picked, when one
 * isn't already configured. The key is validated (one tiny live call) before it's stored, so a bad or
 * quota-limited key is caught here rather than silently ignored. */
export function ApiKeyModal({ providerName, lead, keyUrl, keyUrlLabel, onSave, onClose, onSaved }: ApiKeyModalProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    <Modal title={`Use ${providerName} for AI filtering`} onClose={onClose} contentClassName="api-key-modal">
      <div className="modal__body">
        <p className="api-key-modal__lead">{lead}</p>
        <ol className="api-key-modal__steps">
          <li>
            Open{' '}
            <a href={keyUrl} target="_blank" rel="noreferrer">
              {keyUrlLabel}
            </a>{' '}
            and sign in.
          </li>
          <li>Create an API key and copy it.</li>
          <li>Paste it below.</li>
        </ol>
        <input
          className="api-key-modal__input"
          type="password"
          placeholder={`Paste your ${providerName} API key`}
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
          {saving ? 'Checking…' : 'Save & turn on'}
        </Button>
      </div>
    </Modal>
  );
}
