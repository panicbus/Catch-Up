import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import './ApiKeyModal.css';

const DEFAULT_MODEL = 'qwen2.5:7b';

interface OllamaModalProps {
  currentModel: string;
  /** Live check that Ollama is reachable and the named model is pulled — doesn't save anything. */
  onTest: (model: string) => Promise<{ ok: boolean; error?: string }>;
  /** Save the model name and switch to Ollama. */
  onSave: (model: string) => void;
  onClose: () => void;
}

/** Configures Ollama — a locally-run model, so there's no key to collect, just a model name (a plain
 * editable field, not a live dropdown of installed models) and a way to check it's actually reachable
 * before switching to it. */
export function OllamaModal({ currentModel, onTest, onSave, onClose }: OllamaModalProps) {
  const [model, setModel] = useState(currentModel || DEFAULT_MODEL);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const test = async () => {
    if (testing) return;
    setTesting(true);
    setResult(null);
    const r = await onTest(model);
    setTesting(false);
    setResult(r);
  };

  const save = () => {
    onSave(model);
    onClose();
  };

  return (
    <Modal title="Use Ollama for AI filtering" onClose={onClose} contentClassName="api-key-modal">
      <div className="modal__body">
        <p className="api-key-modal__lead">
          Ollama runs a model locally on this Mac, free, and nothing ever leaves your machine. It
          only works here in the desktop app (the hosted website can’t reach it), and it needs{' '}
          <a href="https://ollama.com" target="_blank" rel="noreferrer">
            Ollama
          </a>{' '}
          already running with the model below pulled.
        </p>
        <input
          className="api-key-modal__input"
          type="text"
          placeholder={DEFAULT_MODEL}
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setResult(null);
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <p className="api-key-modal__note">
          Run <code>ollama pull {model.trim() || DEFAULT_MODEL}</code> in a terminal first if you
          haven’t already.
        </p>
        {result && (
          <p className={result.ok ? 'api-key-modal__note' : 'api-key-modal__error'}>
            {result.ok ? 'Connected. That model is ready.' : result.error}
          </p>
        )}
      </div>
      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={testing}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={test} disabled={testing || model.trim().length === 0}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        <Button variant="primary" onClick={save} disabled={testing || model.trim().length === 0}>
          Save & turn on
        </Button>
      </div>
    </Modal>
  );
}
