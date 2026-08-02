import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../services/api';
import * as channelsStore from '../services/channelsStore';

/** Thin subscriber over the shared channelsStore (src/services/channelsStore.ts) — every one of
 * this hook's ~10 call sites now reads the SAME cached list instead of holding its own copy and
 * fetching independently. useSyncExternalStore (not useState+useEffect) so a warm cache renders
 * correctly on the very first paint, with no synchronous-vs-async tearing between subscribers that
 * happen to render in the same commit. */
export function useChannels() {
  const snapshot = useSyncExternalStore(channelsStore.subscribe, channelsStore.getSnapshot);
  const channels = snapshot ?? [];
  const loading = snapshot === null;

  const reload = useCallback(() => {
    void channelsStore.refresh();
  }, []);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if (event.type === 'channels' || event.type === 'subchannels') reload();
    });
  }, [reload]);

  return { channels, loading, reload };
}
