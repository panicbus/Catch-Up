import { useCallback, useState } from 'react';
import { api } from '../services/api';
import { useReloadOnDataChange } from './useReloadOnDataChange';
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
 * fan-out-then-merge shape as useChannelCounts: N parallel per-channel getArticles calls,
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
    // ONE request for every channel, rather than one per channel. The server applies the limit
    // globally (newest-first across all of them), which is what a chronological cross-channel pool
    // wants anyway — a busy channel shouldn't be trimmed to match a quiet one.
    const nameById = new Map(channels.map((c) => [c.id, c.name]));
    void api
      .getArticles({
        channelId: '',
        channelIds: channels.map((c) => c.id),
        limit: MAX_PER_CHANNEL * channels.length,
      })
      .then((r) => {
        // The same story can legitimately be pulled into two different channels independently (e.g.
        // one matching both a "Tech" and a "Pop Culture" search) — same article id (hashed from its
        // URL) under two different channelIds. Deduping here matters beyond avoiding a visible
        // duplicate: duplicate React keys in one render can leave stale DOM nodes behind on the
        // next, which is what once let a channel-filtered view show more cards than its cap allowed.
        const byId = new Map<string, PoolArticle>();
        for (const a of r.articles) {
          if (!byId.has(a.id)) byId.set(a.id, { ...a, channelName: nameById.get(a.channelId) ?? '' });
        }
        // Already ordered newest-first by the server, but re-sorted here so this doesn't silently
        // depend on that (and stays correct for the desktop bridge's own merge path).
        setArticles(
          [...byId.values()].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [channels]);

  // Still debounced: one poll tick delivers articles + readState + bookmarks, and without this each
  // would trigger its own reload of the same data.
  useReloadOnDataChange(reload, { includeBookmarks: true, debounceMs: 150 });

  return { articles, loading, reload };
}
