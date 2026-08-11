import { useState } from 'react';
import { useAiConfig } from '../../hooks/useAiConfig';
import { ApiKeyModal } from './ApiKeyModal';
import { OllamaModal } from './OllamaModal';
import type { AiProvider } from '../../../ipc-contract';
import './AiFilteringSetting.css';

// Ollama only works from the desktop app — the hosted website has no way to reach a model running
// on the founder's own Mac (see main/providers/classifier.ts's file comment). Same detection as
// main.tsx's isWeb check, inverted.
const isDesktop = typeof window !== 'undefined' && !!window.api;

const PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  ollama: 'Ollama',
};

// Shown below the picker for whichever provider is currently active, so picking one also explains
// what it actually does — free tier, speed/accuracy trade-off, or the local-only caveat.
const PROVIDER_NOTES: Record<AiProvider, string> = {
  gemini: 'Most accurate filtering, less snappy.',
  groq: 'Quick filtering, slightly less precise.',
  ollama: 'Ollama — runs locally on this Mac, no key and no cost, but only filters while Catch Up and Ollama are both running here.',
};

/** The AI relevance-filtering provider picker: off, or one of Gemini / Groq / Ollama (desktop-only).
 * Picking a cloud provider without a key configured opens a key-collecting modal; picking Ollama
 * always opens its model/connection modal, since there's no key, just a model name to confirm. */
export function AiFilteringSetting() {
  const { config, setProvider, saveGeminiKey, saveGroqKey, setOllamaModel, pingOllama } = useAiConfig();
  const [openModal, setOpenModal] = useState<AiProvider | null>(null);

  const on = config.provider != null;

  const choose = (provider: AiProvider | null) => {
    if (provider === null) {
      setProvider(null);
      return;
    }
    if (provider === 'gemini' && config.geminiKeyConfigured) {
      setProvider('gemini');
      return;
    }
    if (provider === 'groq' && config.groqKeyConfigured) {
      setProvider('groq');
      return;
    }
    // No key yet (or Ollama, which always needs its model/connection confirmed) — open the modal.
    setOpenModal(provider);
  };

  return (
    <div className="ai-filtering">
      <div className="ai-filtering__row">
        <span className="ai-filtering__label-title">
          AI relevance filtering
          <span className={`ai-filtering__badge ${on ? 'ai-filtering__badge--on' : ''}`}>
            {on ? PROVIDER_LABELS[config.provider as AiProvider] : 'Off'}
          </span>
        </span>
      </div>

      <p className="ai-filtering__hint">
        Uses AI to check whether incoming stories are relevant to their placed channel or subchannel,
        and filters those that aren’t.
      </p>

      <div className="ai-filtering__options">
        <button
          type="button"
          className={`ai-filtering__option ${config.provider === null ? 'ai-filtering__option--active' : ''}`}
          onClick={() => choose(null)}
        >
          Off
        </button>
        <button
          type="button"
          className={`ai-filtering__option ${config.provider === 'gemini' ? 'ai-filtering__option--active' : ''}`}
          onClick={() => choose('gemini')}
        >
          Gemini
        </button>
        <button
          type="button"
          className={`ai-filtering__option ${config.provider === 'groq' ? 'ai-filtering__option--active' : ''}`}
          onClick={() => choose('groq')}
        >
          Groq
        </button>
        {isDesktop && (
          <button
            type="button"
            className={`ai-filtering__option ${config.provider === 'ollama' ? 'ai-filtering__option--active' : ''}`}
            onClick={() => choose('ollama')}
          >
            Ollama (local)
          </button>
        )}
      </div>

      {config.provider && (
        <p className="ai-filtering__note">{PROVIDER_NOTES[config.provider]}</p>
      )}

      {config.provider === 'gemini' && (
        <p className="ai-filtering__key-status">
          API key is set.{' '}
          <button type="button" className="ai-filtering__replace ai-filtering__replace--key" onClick={() => setOpenModal('gemini')}>
            Replace it here.
          </button>
        </p>
      )}
      {config.provider === 'groq' && (
        <p className="ai-filtering__key-status">
          API key is set.{' '}
          <button type="button" className="ai-filtering__replace ai-filtering__replace--key" onClick={() => setOpenModal('groq')}>
            Replace it here.
          </button>
        </p>
      )}
      {config.provider === 'ollama' && isDesktop && (
        <button type="button" className="ai-filtering__replace ai-filtering__replace--standalone" onClick={() => setOpenModal('ollama')}>
          Change model
        </button>
      )}

      {openModal === 'gemini' && (
        <ApiKeyModal
          providerName="Gemini"
          lead="AI filtering reads each incoming story and drops the ones that aren’t really about your channel. Gemini has a free tier."
          keyUrl="https://aistudio.google.com/api-keys"
          keyUrlLabel="aistudio.google.com/api-keys"
          existingKeyLast4={config.geminiKeyConfigured ? config.geminiKeyLast4 : null}
          onSave={saveGeminiKey}
          onClose={() => setOpenModal(null)}
          onSaved={() => setOpenModal(null)}
        />
      )}
      {openModal === 'groq' && (
        <ApiKeyModal
          providerName="Groq"
          lead="AI filtering reads each incoming story and drops the ones that aren’t really about your channel. Groq has a free tier and serves fast open-source models."
          keyUrl="https://console.groq.com/keys"
          keyUrlLabel="console.groq.com/keys"
          existingKeyLast4={config.groqKeyConfigured ? config.groqKeyLast4 : null}
          onSave={saveGroqKey}
          onClose={() => setOpenModal(null)}
          onSaved={() => setOpenModal(null)}
        />
      )}
      {openModal === 'ollama' && isDesktop && (
        <OllamaModal
          currentModel={config.ollamaModel}
          onTest={pingOllama}
          onSave={setOllamaModel}
          onClose={() => setOpenModal(null)}
        />
      )}
    </div>
  );
}
