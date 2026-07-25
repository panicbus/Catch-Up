import { useCallback, useMemo, useState } from 'react';
import { api } from '../services/api';
import { useReloadOnDataChange } from './useReloadOnDataChange';
import type { Article } from '../../ipc-contract';

export interface ChannelArticles {
  /** Articles for the active subchannel, or the whole channel when activeSubchannelId is null.
   * Filtered client-side from the single full-channel fetch, so switching subchannels is instant. */
  articles: Article[];
  loading: boolean;
  reload: () => void;
  /** Unread count per subchannel id — the pill badges. */
  subchannelCounts: Record<string, number>;
  /** Channel-wide unread total — the "All" pill badge. */
  totalUnread: number;
}

/** Single source of truth for a channel page. One getArticles fetch of the WHOLE channel drives both
 * the (client-side-filtered) feed and the per-subchannel unread badges — so there's never a second
 * identical fetch just to count, switching subchannels needs no refetch, and read/refresh bursts
 * reload once here instead of once per subscribed hook. Replaces the old useArticles +
 * useSubchannelCounts pair, which each fetched the same channel independently.
 *
 * A story is tagged with the subchannelId of the search that first found it (null = channel-level),
 * which is exactly how a pill filters the view — so a null-tagged unread counts toward the total but
 * no subchannel, and the per-subchannel numbers can sum to less than the total. */
export function useChannelArticles(channelId: string | null, activeSubchannelId: string | null): ChannelArticles {
  // Tag the loaded set with the channel it's for. On a channel switch the previous channel's data
  // lingers for one fetch (same as the feed always has — clearing it would flash an empty "all
  // caught up" screen), but tagging lets the counts below ignore it so the pills never show the
  // previous channel's numbers.
  const [loaded, setLoaded] = useState<{ channelId: string | null; articles: Article[] }>({
    channelId: null,
    articles: [],
  });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!channelId) {
      setLoaded({ channelId: null, articles: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    void api.getArticles({ channelId, subchannelId: null }).then((r) => {
      setLoaded({ channelId, articles: r.articles });
      setLoading(false);
    });
  }, [channelId]);

  useReloadOnDataChange(reload, { channelId, includeBookmarks: true });

  const articles = useMemo(
    () => (activeSubchannelId ? loaded.articles.filter((a) => a.subchannelId === activeSubchannelId) : loaded.articles),
    [loaded, activeSubchannelId]
  );

  const { subchannelCounts, totalUnread } = useMemo(() => {
    // Don't trust counts derived from another channel's still-loading data.
    if (loaded.channelId !== channelId) return { subchannelCounts: {}, totalUnread: 0 };
    const byId: Record<string, number> = {};
    let total = 0;
    for (const a of loaded.articles) {
      if (a.read) continue;
      total += 1;
      if (a.subchannelId) byId[a.subchannelId] = (byId[a.subchannelId] ?? 0) + 1;
    }
    return { subchannelCounts: byId, totalUnread: total };
  }, [loaded, channelId]);

  return { articles, loading, reload, subchannelCounts, totalUnread };
}
