import { useEffect, useRef, type RefObject } from 'react';

/** How long a card must stay scrolled above the top before it counts as "read" — long enough that a
 * quick flick-scroll that overshoots and comes back doesn't clear anything you didn't mean to. */
const PASS_DELAY_MS = 500;
/** How close to the bottom (px) counts as "reached the bottom of the feed." */
const BOTTOM_THRESHOLD_PX = 8;
/** Minimum gap between bottom-reached clears, so sitting at the bottom across reveal-more waves
 * fires at most once per beat rather than on every scroll tick. */
const BOTTOM_COOLDOWN_MS = 400;

interface Options {
  /** The feed container (its scroll ancestor `.app-shell__main` is found from here and used as the
   * IntersectionObserver root — the window itself never scrolls in this layout). */
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** A signature of the currently-unread card ids. Changing it re-attaches the per-card observer so
   * newly-revealed unread cards get watched and just-cleared ones get dropped. */
  unreadKey: string;
  onPassedTop: (articleId: string) => void;
  onReachedBottom: () => void;
}

/** Marks stories read as you move past them: a card that scrolls fully above the top edge clears
 * itself (after a short grace delay), and reaching the bottom of the scroll area clears whatever is
 * still on screen (the last screenful, which never crosses the top on its own). Reads its callbacks
 * through refs so they can change every render without tearing down the observers. */
export function useScrollCatchUp({ containerRef, enabled, unreadKey, onPassedTop, onReachedBottom }: Options) {
  const onPassedTopRef = useRef(onPassedTop);
  const onReachedBottomRef = useRef(onReachedBottom);
  onPassedTopRef.current = onPassedTop;
  onReachedBottomRef.current = onReachedBottom;

  // Guards the bottom-reached clear from firing on a short feed that fits on screen without ever
  // being scrolled (nothing was scrolled past, so nothing should be assumed "caught up").
  const hasScrolledRef = useRef(false);

  // Scroll handling: track that the user has actually scrolled, and detect arrival at the bottom to
  // clear the on-screen stragglers. Scroll-position based (rather than a bottom-sentinel observer)
  // so it re-checks on every scroll rather than depending on enter/exit transitions, which can be
  // missed while sitting at the bottom as more unread is revealed underneath.
  useEffect(() => {
    if (!enabled) return;
    const root = containerRef.current?.closest<HTMLElement>('.app-shell__main');
    if (!root) return;
    let coolingDown = false;
    const onScroll = () => {
      if (root.scrollTop > 4) hasScrolledRef.current = true;
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - BOTTOM_THRESHOLD_PX;
      if (atBottom && hasScrolledRef.current && !coolingDown) {
        coolingDown = true;
        onReachedBottomRef.current();
        window.setTimeout(() => {
          coolingDown = false;
        }, BOTTOM_COOLDOWN_MS);
      }
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [enabled, containerRef]);

  // Per-card: clear a story once it has scrolled fully above the top, after a grace delay that a
  // scroll-back cancels. Re-runs when the unread set changes so the observed nodes stay current.
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const root = container?.closest<HTMLElement>('.app-shell__main');
    if (!container || !root) return;

    // Push the trigger line down below the sticky nav so a card visibly grays out *before* it slides
    // up under the toolbar, instead of clearing while already hidden behind it. Measured live (the
    // nav grows when subchannel pills wrap to multiple rows), plus a small buffer.
    const navHeight = root.querySelector<HTMLElement>('[data-sticky-nav]')?.getBoundingClientRect().height ?? 0;
    const topInset = Math.round(navHeight) + 16;

    const timers = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.articleId;
          if (!id) continue;
          const exitedTop =
            !entry.isIntersecting &&
            entry.rootBounds != null &&
            entry.boundingClientRect.bottom <= entry.rootBounds.top;
          if (exitedTop) {
            if (!timers.has(id)) {
              const t = window.setTimeout(() => {
                timers.delete(id);
                onPassedTopRef.current(id);
              }, PASS_DELAY_MS);
              timers.set(id, t);
            }
          } else if (entry.isIntersecting) {
            const t = timers.get(id);
            if (t != null) {
              window.clearTimeout(t);
              timers.delete(id);
            }
          }
        }
      },
      { root, threshold: 0, rootMargin: `-${topInset}px 0px 0px 0px` }
    );

    container
      .querySelectorAll<HTMLElement>('[data-article-id][data-unread="true"]')
      .forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [enabled, containerRef, unreadKey]);
}
