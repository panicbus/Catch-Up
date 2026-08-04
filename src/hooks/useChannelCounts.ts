import { useCallback, useState } from 'react';
import { api } from '../services/api';
import { useReloadOnDataChange } from './useReloadOnDataChange';
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
 * Computed once here rather than each tile fetching independently, since the header needs the sum
 * across every channel. */
export function useChannelCounts(channels: Channel[]) {
  const [counts, setCounts] = useState<Record<string, ChannelCount>>({});

  const reload = useCallback(() => {
    void Promise.all(
      channels.map((c) =>
        api.getArticles({ channelId: c.id, subchannelId: null }).then(
          (r) => {
            const unread = r.articles.filter((a) => !a.read);
            return [
              c.id,
              { unread: unread.length, recent: unread.filter((a) => isNewArticle(a.publishedAt)).length },
            ] as const;
          },
          // One channel's fetch failing (a rate limit, a network hiccup, a cold-starting server)
          // must not blank out every OTHER channel's tile too — Promise.all rejects the whole batch
          // on a single rejection, and the un-caught rejection this used to leave behind meant
          // setCounts never even ran, silently leaving every tile's count stuck at whatever it last
          // was (blank, on first load). Skip just this one channel instead.
          () => null
        )
      )
    ).then((pairs) => {
      // Merge into the previous counts rather than replacing wholesale, so a channel that failed
      // this cycle keeps showing its last known good count instead of going blank.
      setCounts((prev) => {
        const next = { ...prev };
        for (const pair of pairs) {
          if (pair) next[pair[0]] = pair[1];
        }
        return next;
      });
    });
  }, [channels]);

  // Coalesce: a background sweep broadcasts one 'articles' event per channel, and each reload here
  // re-fetches EVERY channel — without debouncing, an N-channel sweep would fire N × N fetches. The
  // home tiles show only counts (no scroll-to-read dimming), so a small settle delay is invisible.
  useReloadOnDataChange(reload, { debounceMs: 150 });

  const totalUnread = Object.values(counts).reduce((sum, c) => sum + c.unread, 0);

  return { counts, totalUnread };
}
