import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AppSettings } from '../../ipc-contract';

const FALLBACK: AppSettings = {
  defaultViewMode: 'list',
  defaultSortMode: 'newest',
  refreshIntervalMinutes: 30,
  theme: 'light',
  rollTheDiceChannelIds: null,
  trustedSourceDomains: [],
  maxStoriesShown: 25,
  homeLocation: null,
  digestEnabled: false,
  digestSendHour: 7,
  digestTimezone: null,
  digestChannelIds: [],
  digestEmailOverride: null,
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

  // Returns the underlying request so a caller that shows its own "saved" state (e.g. LocationSetting)
  // can wait for the real round trip instead of declaring success the instant the optimistic local
  // update above lands — a real-world gap: a Save button that flips to "Currently set to: ..." right
  // away invites the next thing you do to be closing the app, and on mobile a force-close (swiping the
  // app away, not a graceful quit) can abort a still-in-flight request outright, silently discarding
  // it server-side. Most callers still fire-and-forget this exactly as before; returning a promise
  // doesn't change their behavior since none of them await it.
  const update = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    return api.setSettings(partial);
  }, []);

  return { settings, loading, update };
}
