import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AppSettings } from '../../ipc-contract';

const FALLBACK: AppSettings = { defaultViewMode: 'list', refreshIntervalMinutes: 30, theme: 'light' };

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    void api.getSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if (event.type === 'settings') reload();
    });
  }, [reload]);

  const update = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    void api.setSettings(partial);
  }, []);

  return { settings, loading, update };
}
