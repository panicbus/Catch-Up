import { useState } from 'react';
import { useAiConfig } from '../../hooks/useAiConfig';
import { ApiKeyModal } from './ApiKeyModal';
import './AiFilteringSetting.css';

/** The AI relevance-filtering toggle. Turning it on without a key configured opens a modal that
 * walks the user through minting a free Gemini key; once saved, filtering turns on automatically.
 * With a key already configured, the toggle just flips on/off. */
export function AiFilteringSetting() {
  const { config, setEnabled, saveKey } = useAiConfig();
  const [modalOpen, setModalOpen] = useState(false);

  const on = config.enabled && config.keyConfigured;

  const handleToggle = () => {
    if (on) {
      setEnabled(false);
      return;
    }
    // Turning on: need a key first.
    if (config.keyConfigured) setEnabled(true);
    else setModalOpen(true);
  };

  return (
    <div className="ai-filtering">
      <div className="ai-filtering__row">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="AI relevance filtering"
          className={`ai-filtering__switch ${on ? 'ai-filtering__switch--on' : ''}`}
          onClick={handleToggle}
        >
          <span className="ai-filtering__knob" />
        </button>
        <div className="ai-filtering__label">
          <span className="ai-filtering__label-title">
            AI relevance filtering
            <span className={`ai-filtering__badge ${on ? 'ai-filtering__badge--on' : ''}`}>
              {on ? 'On' : 'Off'}
            </span>
          </span>
          <span className="ai-filtering__label-sub">
            {on ? 'Powered by Google Gemini' : 'Uses a free Google Gemini key'}
          </span>
        </div>
      </div>

      <p className="ai-filtering__hint">
        Uses AI to check whether incoming stories are relevant to their placed channel or subchannel,
        and filters those that aren’t.
      </p>

      {config.keyConfigured && (
        <button type="button" className="ai-filtering__replace" onClick={() => setModalOpen(true)}>
          Replace API key
        </button>
      )}

      {modalOpen && (
        <ApiKeyModal
          onSave={saveKey}
          onClose={() => setModalOpen(false)}
          onSaved={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
