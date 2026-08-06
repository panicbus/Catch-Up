import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AiConfig, AiProvider } from '../../ipc-contract';

const DEFAULT_CONFIG: AiConfig = {
  provider: null,
  geminiKeyConfigured: false,
  groqKeyConfigured: false,
  geminiKeyLast4: null,
  groqKeyLast4: null,
  ollamaModel: '',
};

/** AI relevance-filtering config for the Settings provider picker + key/model modals. Full keys
 * never cross into the renderer — this only knows the active provider, whether each key is
 * configured, and its last 4 characters (enough for the Settings UI to confirm a key is saved). */
export function useAiConfig() {
  const [config, setConfig] = useState<AiConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    void api.getAiConfig().then((c) => {
      setConfig(c);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    reload();
    // saveGeminiApiKey / saveGroqApiKey / setAiProvider / setOllamaModel all broadcast 'settings'.
    return api.onDataChanged((event) => {
      if (event.type === 'settings') reload();
    });
  }, [reload]);

  const setProvider = useCallback((provider: AiProvider | null) => {
    setConfig((prev) => ({ ...prev, provider })); // optimistic
    void api.setAiProvider(provider);
  }, []);

  /** Validate + store a Gemini key (switches to Gemini when it succeeds). Result is for the modal. */
  const saveGeminiKey = useCallback((key: string) => api.saveGeminiApiKey(key), []);

  /** Validate + store a Groq key (switches to Groq when it succeeds). Result is for the modal. */
  const saveGroqKey = useCallback((key: string) => api.saveGroqApiKey(key), []);

  /** Save the Ollama model name and switch to Ollama. Desktop-only. */
  const setOllamaModel = useCallback((model: string) => {
    setConfig((prev) => ({ ...prev, provider: 'ollama', ollamaModel: model })); // optimistic
    void api.setOllamaModel(model);
  }, []);

  /** Check Ollama is reachable and the model is pulled, without saving anything. Desktop-only. */
  const pingOllama = useCallback((model: string) => api.pingOllama(model), []);

  return { config, loading, setProvider, saveGeminiKey, saveGroqKey, setOllamaModel, pingOllama };
}
