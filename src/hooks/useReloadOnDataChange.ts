import { useEffect } from 'react';
import { api } from '../services/api';
import type { DataChangeEvent } from '../../ipc-contract';

interface Options {
  /** Only react to events for this channel (channel-less broadcasts always pass). Omit entirely to
   * react to every channel's events — used by the aggregate hooks (home tiles, The Pool). */
  channelId?: string | null;
  /** Also reload on 'bookmarks' events — for views that render bookmark state, not just read state. */
  includeBookmarks?: boolean;
  /** Coalesce bursts of events into a single reload after this many ms of quiet. Opt in to a real
   * delay only where a lag is invisible AND the burst is costly — e.g. the home tiles, where one
   * poll broadcasts an 'articles' event PER channel and each reload re-fans-out every channel.
   *
   * Note that 0 (the default) is NOT "no coalescing" — see the scheduler below. */
  debounceMs?: number;
}

/** Shared wiring for the renderer's article-derived hooks: run `reload` once on mount and again
 * whenever relevant article/read (optionally bookmark) data changes. `reload` must be a stable
 * useCallback — it's a dependency, so an unstable one re-subscribes every render. Replaces the
 * near-identical onDataChanged effect each of these hooks used to hand-roll. */
export function useReloadOnDataChange(reload: () => void, options: Options = {}): void {
  const { channelId, includeBookmarks = false, debounceMs = 0 } = options;

  useEffect(() => {
    reload();

    let timer: ReturnType<typeof setTimeout> | null = null;
    // Always trailing-debounced, including at debounceMs: 0 (which becomes setTimeout(…, 0) — the
    // same macrotask, still before paint, so it stays visually immediate).
    //
    // This used to call `reload` synchronously per event at 0, which was a real cost: one poll tick
    // delivers 'articles' + 'readState' + 'bookmarks' in a single synchronous loop, so a channel
    // page fired THREE identical /articles requests every 20 seconds and Bookmarks fired two. The
    // duplicates were pure waste — same tick, same response. Coalescing here fixes it once for
    // every consumer instead of per hook.
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        reload();
      }, debounceMs);
    };

    const unsubscribe = api.onDataChanged((event: DataChangeEvent) => {
      const relevant =
        event.type === 'articles' ||
        event.type === 'readState' ||
        (includeBookmarks && event.type === 'bookmarks');
      if (!relevant) return;
      // `channelId === undefined` means "no channel filter" (aggregate hooks). Otherwise scope to
      // this channel, but always let through channel-less broadcasts (event.channelId undefined).
      if (channelId !== undefined && event.channelId && event.channelId !== channelId) return;
      schedule();
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [reload, channelId, includeBookmarks, debounceMs]);
}
