import { useCallback, useMemo, useState } from 'react';
import { api } from '../services/api';
import { useReloadOnDataChange } from './useReloadOnDataChange';
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
    // ONE aggregate call, not one full article fetch per channel. This used to download every
    // article of every channel — complete rows, snippets and all — every poll tick, purely to call
    // .length on the result. With nine channels that was the single largest source of database
    // traffic once the background job was fixed, and it's what exhausted the hosting quota on
    // 2026-08-05. The server now counts in SQL and returns two integers per channel.
    void api.getChannelCounts().then(
      // Merge rather than replace, so a channel missing from the response (it has no articles yet,
      // so no row in the aggregate) keeps whatever it last showed instead of flickering blank.
      (fresh) => setCounts((prev) => ({ ...prev, ...fresh })),
      // A failed poll must not blank every tile — keep the last known counts and try again next
      // tick, same "a background sync failure never breaks the app" rule as the rest of this code.
      () => {}
    );
  }, []);

  // Coalesce: one poll broadcasts an 'articles' event per channel, and every one of them would
  // otherwise trigger this same single request. The home tiles show only counts, so a small settle
  // delay is invisible.
  useReloadOnDataChange(reload, { debounceMs: 150 });

  // Scoped to channels that currently exist. `counts` is merged across reloads (so a channel absent
  // from one response keeps its last known value rather than flickering), which on its own would
  // also keep DELETED channels around forever and overstate the header total. The channel list is
  // the authority on what exists; this is the only thing it's needed for.
  const visible = useMemo(() => {
    const live: Record<string, ChannelCount> = {};
    for (const c of channels) if (counts[c.id]) live[c.id] = counts[c.id];
    return live;
  }, [channels, counts]);

  const totalUnread = Object.values(visible).reduce((sum, c) => sum + c.unread, 0);

  return { counts: visible, totalUnread };
}
