import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { isNewArticle } from '../utils/isNew';
import type { Channel } from '../../ipc-contract';

/** Per-channel + aggregate "new" (<24h old) article counts, computed once here rather than each
 * channel tile independently calling useArticles — needed because the home view's header shows
 * the sum across every channel, not just a per-tile badge. */
export function useChannelNewCounts(channels: Channel[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const reload = useCallback(() => {
    void Promise.all(
      channels.map((c) =>
        api
          .getArticles({ channelId: c.id, subchannelId: null })
          .then((r) => [c.id, r.articles.filter((a) => isNewArticle(a.publishedAt)).length] as const)
      )
    ).then((pairs) => setCounts(Object.fromEntries(pairs)));
  }, [channels]);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if (event.type === 'articles' || event.type === 'readState') reload();
    });
  }, [reload]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return { counts, total };
}
