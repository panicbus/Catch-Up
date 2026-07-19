import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { BookmarkEntry } from '../../ipc-contract';

export function useBookmarks() {
  const [byChannel, setByChannel] = useState<Record<string, BookmarkEntry[]>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    void api.getBookmarksByChannel().then((data) => {
      setByChannel(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if (event.type === 'bookmarks') reload();
    });
  }, [reload]);

  return { byChannel, loading, reload };
}
