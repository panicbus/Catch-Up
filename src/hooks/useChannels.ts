import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Channel } from '../../ipc-contract';

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    void api.getChannels().then((c) => {
      setChannels(c);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if (event.type === 'channels' || event.type === 'subchannels') reload();
    });
  }, [reload]);

  return { channels, loading, reload };
}
