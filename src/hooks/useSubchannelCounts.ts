import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';

/** Per-subchannel unread counts for a channel's pill bar, plus the channel-wide unread total (for
 * the "All" pill). One getArticles call returns the whole channel; each article carries the
 * subchannelId of the search that first found it (null = channel-level), so we tally `!read` by that
 * — matching exactly what clicking a pill filters the view down to. A story tagged null counts
 * toward the total but no subchannel, so the per-subchannel numbers can sum to less than the total. */
export function useSubchannelCounts(channelId: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totalUnread, setTotalUnread] = useState(0);

  const reload = useCallback(() => {
    if (!channelId) {
      setCounts({});
      setTotalUnread(0);
      return;
    }
    void api.getArticles({ channelId, subchannelId: null }).then((r) => {
      const byId: Record<string, number> = {};
      let total = 0;
      for (const a of r.articles) {
        if (a.read) continue;
        total += 1;
        if (a.subchannelId) byId[a.subchannelId] = (byId[a.subchannelId] ?? 0) + 1;
      }
      setCounts(byId);
      setTotalUnread(total);
    });
  }, [channelId]);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if ((event.type === 'articles' || event.type === 'readState') && (!event.channelId || event.channelId === channelId)) {
        reload();
      }
    });
  }, [reload, channelId]);

  return { counts, totalUnread };
}
