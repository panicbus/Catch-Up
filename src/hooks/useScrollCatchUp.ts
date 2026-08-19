import { useEffect, useRef, type RefObject } from 'react';

/** How long a card must stay scrolled above the top before it counts as "read" — long enough that a
 * quick flick-scroll that overshoots and comes back doesn't clear anything you didn't mean to, short
 * enough that it doesn't read as sluggish on an otherwise-fast mobile scroll. */
const PASS_DELAY_MS = 300;
/** How close to the bottom (px) counts as "reached the bottom of the feed." Generous rather than
 * pixel-exact — mobile browsers report fractional/rubber-banding scrollTop/scrollHeight values
 * (especially mid-momentum-scroll or during Safari's dynamic toolbar show/hide), and a tight
 * threshold here missed "reached bottom" often enough on a phone to read as this just not working. */
const BOTTOM_THRESHOLD_PX = 32;
/** How long the scroll position must sit continuously at the bottom before clearing what's on
 * screen — long enough that a rubber-band overscroll bounce (which springs back well under a second)
 * or the momentary bottom-threshold trip from iOS's toolbar sliding away never counts, short enough
 * that it doesn't feel like the app ignored you. */
const BOTTOM_DWELL_MS = 2000;
/** Coalesces a burst of ResizeObserver ticks into one rebuild — the subchannel picker/manage panels
 * both animate their own height (SubchannelPicker.css's 0.2s grid-template-rows transition) inside
 * the very element this observes ([data-sticky-nav]), so opening or closing either one fires the
 * observer on nearly every frame for that whole 0.2s. Longer than a frame, short enough that a
 * genuine one-off resize (not part of an animation) still rebuilds promptly once things settle. */
const RESIZE_DEBOUNCE_MS = 150;

interface Options {
  /** The feed container (its scroll ancestor `.app-shell__main` is found from here and used as the
   * IntersectionObserver root — the window itself never scrolls in this layout). */
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** A signature of the currently-unread card ids (order-independent — see NewsFeed's own comment on
   * how it's built). Changing it tells this hook which cards to watch; it does NOT tear down and
   * rebuild the underlying IntersectionObserver itself — see the effect below for why that
   * distinction is load-bearing. */
  unreadKey: string;
  onPassedTop: (articleId: string) => void;
  /** Fired once, after the scroll position has sat continuously at the bottom for BOTTOM_DWELL_MS —
   * with the ids of unread cards that are ACTUALLY on screen at that moment, and only those. Never
   * the full unread list: a story that's still off-screen hasn't been displayed and scrolled past the
   * top, which is the one thing that's supposed to mark something read here. */
  onReachedBottom: (visibleArticleIds: string[]) => void;
}

/** Marks stories read as you move past them: a card that scrolls fully above the top edge clears
 * itself (after a short grace delay), and sitting at the bottom of the feed for a couple of seconds
 * clears whatever's still visible on screen (the last screenful, which never crosses the top on its
 * own). Reads its callbacks through refs so they can change every render without tearing down the
 * observer. */
export function useScrollCatchUp({ containerRef, enabled, unreadKey, onPassedTop, onReachedBottom }: Options) {
  const onPassedTopRef = useRef(onPassedTop);
  const onReachedBottomRef = useRef(onReachedBottom);
  onPassedTopRef.current = onPassedTop;
  onReachedBottomRef.current = onReachedBottom;

  // Guards the bottom-reached clear from firing on a short feed that fits on screen without ever
  // being scrolled (nothing was scrolled past, so nothing should be assumed "caught up").
  const hasScrolledRef = useRef(false);

  // Which unread cards are CURRENTLY intersecting the viewport — read by the bottom-dwell timer below
  // to know what's actually on screen the moment it fires. Kept alongside the per-card observer
  // further down since both need the same per-card intersection state; a separate DOM query at
  // dwell-fire time would just be redoing what that observer's callback already knows in the moment.
  const visibleIdsRef = useRef(new Set<string>());

  // Bottom dwell: waits for the scroll position to sit at the bottom continuously for BOTTOM_DWELL_MS
  // before clearing anything, and clears only what's actually on screen right then (visibleIdsRef) —
  // never the whole loaded list. The previous version fired the instant `atBottom` went true even
  // once, with no dwell at all, and cleared every unread story loaded for the channel (up to
  // maxStoriesShown) regardless of whether it had ever been on screen — confirmed live as the "marks
  // the whole channel read on its own" defect, since iOS rubber-band overscroll and the dynamic
  // toolbar sliding away can both trip a bare `atBottom` check within a second of opening a channel.
  useEffect(() => {
    if (!enabled) return;
    const root = containerRef.current?.closest<HTMLElement>('.app-shell__main');
    if (!root) return;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    const clearDwell = () => {
      if (dwellTimer) {
        clearTimeout(dwellTimer);
        dwellTimer = null;
      }
    };
    const onScroll = () => {
      if (root.scrollTop > 4) hasScrolledRef.current = true;
      // visualViewport tracks the actually-visible area through iOS Safari's dynamic toolbar
      // show/hide; clientHeight alone changes as that toolbar animates, with no real scroll intent
      // behind it, which used to be enough on its own to trip the bottom check.
      const visibleHeight = window.visualViewport?.height ?? root.clientHeight;
      const atBottom = root.scrollTop + visibleHeight >= root.scrollHeight - BOTTOM_THRESHOLD_PX;
      if (atBottom && hasScrolledRef.current) {
        if (!dwellTimer) {
          dwellTimer = setTimeout(() => {
            dwellTimer = null;
            onReachedBottomRef.current(Array.from(visibleIdsRef.current));
          }, BOTTOM_DWELL_MS);
        }
      } else {
        clearDwell();
      }
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearDwell();
      root.removeEventListener('scroll', onScroll);
    };
  }, [enabled, containerRef]);

  // Owns the IntersectionObserver's actual lifetime. Deliberately NOT keyed on unreadKey — tearing
  // the observer down and rebuilding it cancels every card's in-flight PASS_DELAY_MS timer via its
  // cleanup, which used to happen on every single read (each one changes the unread set), so a card
  // seconds away from clearing kept having its clock reset by the next card being read, and nothing
  // ever finished individually — confirmed live as reads arriving in big delayed batches instead of
  // one at a time. Rebuilt only when the measured top offset (the sticky nav's real height) actually
  // changes, via ResizeObserver — a cause with nothing to do with reads at all.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const timersRef = useRef(new Map<string, number>());
  const watchedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const root = container?.closest<HTMLElement>('.app-shell__main');
    if (!container || !root) return;

    const handleEntries: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.articleId;
        if (!id) continue;
        if (entry.isIntersecting) {
          visibleIdsRef.current.add(id);
          const t = timersRef.current.get(id);
          if (t != null) {
            window.clearTimeout(t);
            timersRef.current.delete(id);
          }
          continue;
        }
        visibleIdsRef.current.delete(id);
        // Only "exited above the top" starts the read timer — a card that hasn't been scrolled to
        // yet (still below the fold) is just as non-intersecting, and must never be mistaken for
        // having been read.
        const exitedTop = entry.rootBounds != null && entry.boundingClientRect.bottom <= entry.rootBounds.top;
        if (exitedTop && !timersRef.current.has(id)) {
          const t = window.setTimeout(() => {
            timersRef.current.delete(id);
            onPassedTopRef.current(id);
          }, PASS_DELAY_MS);
          timersRef.current.set(id, t);
        }
      }
    };

    const build = () => {
      observerRef.current?.disconnect();
      // Push the trigger line down below the sticky nav so a card visibly grays out *before* it
      // slides up under the toolbar, instead of clearing while already hidden behind it. Measured
      // live (the nav grows when subchannel pills wrap to multiple rows), plus a small buffer.
      const navHeight = root.querySelector<HTMLElement>('[data-sticky-nav]')?.getBoundingClientRect().height ?? 0;
      const topInset = Math.round(navHeight) + 16;
      const observer = new IntersectionObserver(handleEntries, {
        root,
        threshold: 0,
        rootMargin: `-${topInset}px 0px 0px 0px`,
      });
      observerRef.current = observer;
      // A rebuild (nav height changed) re-observes whatever this hook already considers watched —
      // the reconciliation effect below owns deciding WHAT's watched, this only owns the observer
      // instance itself.
      for (const id of watchedIdsRef.current) {
        const el = container.querySelector<HTMLElement>(`[data-article-id="${CSS.escape(id)}"]`);
        if (el) observer.observe(el);
      }
    };
    build();

    // Debounced — see RESIZE_DEBOUNCE_MS's own comment. Without this, an animating sticky nav (the
    // subchannel picker/manage panels both transition their height) fired a full rebuild — disconnect,
    // recreate the IntersectionObserver, re-observe every watched card, plus the getBoundingClientRect()
    // read in build() itself — on nearly every frame of that animation, all the way through it.
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleBuild = () => {
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        resizeDebounceTimer = null;
        build();
      }, RESIZE_DEBOUNCE_MS);
    };
    const navEl = root.querySelector<HTMLElement>('[data-sticky-nav]');
    const resizeObserver = navEl ? new ResizeObserver(scheduleBuild) : null;
    if (navEl && resizeObserver) resizeObserver.observe(navEl);

    return () => {
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      resizeObserver?.disconnect();
      observerRef.current?.disconnect();
      observerRef.current = null;
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current.clear();
      watchedIdsRef.current.clear();
      visibleIdsRef.current.clear();
    };
  }, [enabled, containerRef]);

  // Reconciliation: on every unread-set change, observe newly-unread cards and unobserve/forget ones
  // no longer unread. Never touches the observer instance itself or any OTHER card's timer — that
  // separation from the effect above is the whole point.
  useEffect(() => {
    if (!enabled) return;
    const observer = observerRef.current;
    const container = containerRef.current;
    if (!observer || !container) return;

    const nowUnread = new Set(
      Array.from(container.querySelectorAll<HTMLElement>('[data-article-id][data-unread="true"]')).map(
        (el) => el.dataset.articleId!
      )
    );

    for (const id of watchedIdsRef.current) {
      if (nowUnread.has(id)) continue;
      const el = container.querySelector<HTMLElement>(`[data-article-id="${CSS.escape(id)}"]`);
      if (el) observer.unobserve(el);
      const t = timersRef.current.get(id);
      if (t != null) {
        window.clearTimeout(t);
        timersRef.current.delete(id);
      }
      watchedIdsRef.current.delete(id);
      visibleIdsRef.current.delete(id);
    }
    for (const id of nowUnread) {
      if (watchedIdsRef.current.has(id)) continue;
      const el = container.querySelector<HTMLElement>(`[data-article-id="${CSS.escape(id)}"]`);
      if (el) {
        observer.observe(el);
        watchedIdsRef.current.add(id);
      }
    }
  }, [enabled, containerRef, unreadKey]);
}
