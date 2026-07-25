import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AiConfig } from '../../ipc-contract';

/** AI relevance-filtering config for the Settings toggle + key modal. The API key never crosses into
 * the renderer — this only knows whether AI is enabled and whether a key is configured. */
export function useAiConfig() {
  const [config, setConfig] = useState<AiConfig>({ enabled: false, keyConfigured: false });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    void api.getAiConfig().then((c) => {
      setConfig(c);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    reload();
    // saveGeminiApiKey / setAiFilteringEnabled broadcast a 'settings' change.
    return api.onDataChanged((event) => {
      if (event.type === 'settings') reload();
    });
  }, [reload]);

  const setEnabled = useCallback((enabled: boolean) => {
    setConfig((prev) => ({ ...prev, enabled })); // optimistic
    void api.setAiFilteringEnabled(enabled);
  }, []);

  /** Validate + store a key (main turns AI on when it succeeds). Returns the result for the modal. */
  const saveKey = useCallback((key: string) => api.saveGeminiApiKey(key), []);

  return { config, loading, setEnabled, saveKey };
}
