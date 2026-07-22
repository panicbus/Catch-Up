import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Article, Channel } from '../../ipc-contract';

export interface PoolArticle extends Article {
  channelName: string;
}

/** The largest shown-count The Pool's own UI offers (see PoolPage's SHOWN_OPTIONS) — the ceiling
 * on how many articles from a single channel could ever actually be needed at once, even if the
 * user filters down to just that one channel. Keeps the per-channel fetch well below getArticles'
 * own 100 default without risking ever coming up short for a legitimate view. */
const MAX_PER_CHANNEL = 50;

/** Aggregates every channel's articles (channel-level and subchannel-level alike — The Pool
 * doesn't drill into subchannels, only whole channels) into one chronological list. Same
 * fan-out-then-merge shape as useChannelNewCounts: N parallel per-channel getArticles calls,
 * merged client-side, rather than a new IPC endpoint — articles already carry channelId, so
 * there's nothing a main-process change would buy here. */
export function usePoolArticles(channels: Channel[]) {
  const [articles, setArticles] = useState<PoolArticle[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (channels.length === 0) {
      setArticles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all(
      channels.map((c) =>
        api
          .getArticles({ channelId: c.id, subchannelId: null, limit: MAX_PER_CHANNEL })
          .then((r) => r.articles.map((a): PoolArticle => ({ ...a, channelName: c.name })))
      )
    ).then((lists) => {
      // The same story can legitimately get pulled into two different channels' buckets
      // independently (e.g. a story matching both "Tech" and "Pop Culture" searches) — same
      // article id (hashed from its URL) under two different channelIds. Deduping here (rather
      // than relying on React keys to sort it out) matters beyond just avoiding a duplicate card:
      // duplicate keys within one render can leave stale DOM nodes behind on the next re-render,
      // which is exactly what let a channel-filtered view briefly show more cards than the
      // shown-count cap allowed.
      const byId = new Map<string, PoolArticle>();
      for (const article of lists.flat()) {
        if (!byId.has(article.id)) byId.set(article.id, article);
      }
      const merged = [...byId.values()].sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
      setArticles(merged);
      setLoading(false);
    });
  }, [channels]);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if (event.type === 'articles' || event.type === 'bookmarks' || event.type === 'readState') reload();
    });
  }, [reload]);

  return { articles, loading, reload };
}
