import { useCallback, useState } from 'react';
import { api } from '../services/api';
import { useReloadOnDataChange } from './useReloadOnDataChange';
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

  // Uses the shared hook rather than its own onDataChanged effect, specifically to inherit that
  // hook's coalescing — 'bookmarks' and 'readState' both arrive in the same synchronous poll loop,
  // and this was firing two identical requests every tick as a result. `includeBookmarks` is what
  // makes 'bookmarks' relevant here; 'readState' is always relevant, which matters because
  // BookmarkEntry.read is computed by joining against read-state at query time (like
  // Article.read/bookmarked) and goes stale without it.
  useReloadOnDataChange(reload, { includeBookmarks: true });

  return { byChannel, loading, reload };
}
