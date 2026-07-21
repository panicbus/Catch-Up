import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AppSettings } from '../../ipc-contract';

const FALLBACK: AppSettings = {
  defaultViewMode: 'list',
  refreshIntervalMinutes: 30,
  theme: 'light',
  rollTheDiceChannelIds: null,
};

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

  // preload.ts already stamps <html data-theme> synchronously before first paint (avoiding a
  // flash) — this just keeps it in sync for the lifetime of the app as the setting changes.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const update = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    void api.setSettings(partial);
  }, []);

  return { settings, loading, update };
}
