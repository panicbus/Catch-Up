import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { isNewArticle } from '../utils/isNew';
import type { Channel } from '../../ipc-contract';

export interface ChannelCount {
  /** Unread stories in the channel — this is "stories to catch up on", and matches exactly what the
   * channel view lists. */
  unread: number;
  /** Of the unread, how many were published in the last 24h — drives the "new" freshness tag. */
  recent: number;
}

/** Per-channel unread counts (plus a recency flag), and the aggregate unread total for the home
 * header. The unread count is what the channel view actually shows — an earlier version counted only
 * <24h-old unread, so a channel full of day-old unread stories misleadingly read as 0 on the home.
 * Computed once here rather than each tile calling useArticles, since the header needs the sum
 * across every channel. */
export function useChannelCounts(channels: Channel[]) {
  const [counts, setCounts] = useState<Record<string, ChannelCount>>({});

  const reload = useCallback(() => {
    void Promise.all(
      channels.map((c) =>
        api.getArticles({ channelId: c.id, subchannelId: null }).then((r) => {
          const unread = r.articles.filter((a) => !a.read);
          return [
            c.id,
            { unread: unread.length, recent: unread.filter((a) => isNewArticle(a.publishedAt)).length },
          ] as const;
        })
      )
    ).then((pairs) => setCounts(Object.fromEntries(pairs)));
  }, [channels]);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if (event.type === 'articles' || event.type === 'readState') reload();
    });
  }, [reload]);

  const totalUnread = Object.values(counts).reduce((sum, c) => sum + c.unread, 0);

  return { counts, totalUnread };
}
