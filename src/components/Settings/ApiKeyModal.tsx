import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import './ApiKeyModal.css';

interface ApiKeyModalProps {
  /** Validates + stores the key; resolves ok:false with a message when the key is rejected. */
  onSave: (key: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  /** Called after a key is accepted, so the parent can reflect the now-on state. */
  onSaved: () => void;
}

/** Collects a Gemini API key when the user turns on AI filtering without one configured. Links out
 * to Google AI Studio so they can mint their own free key. The key is validated (one tiny live call)
 * before it's stored, so a bad or quota-limited key is caught here rather than silently ignored. */
export function ApiKeyModal({ onSave, onClose, onSaved }: ApiKeyModalProps) {
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
    <Modal title="Turn on AI filtering" onClose={onClose} contentClassName="api-key-modal">
      <div className="modal__body">
        <p className="api-key-modal__lead">
          AI filtering reads each incoming story and drops the ones that aren’t really about your
          channel. It runs on Google Gemini, which has a free tier.
        </p>
        <ol className="api-key-modal__steps">
          <li>
            Open{' '}
            <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">
              aistudio.google.com/api-keys
            </a>{' '}
            and sign in with a Google account.
          </li>
          <li>Click <strong>Create API key</strong> and copy it.</li>
          <li>Paste it below.</li>
        </ol>
        <input
          className="api-key-modal__input"
          type="password"
          placeholder="Paste your Gemini API key"
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
