import { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { flushSync } from 'react-dom';
import { groupByDay } from '../../utils/groupByDay';
import { intersperseByContent } from '../../utils/intersperseByContent';
import { formatDateHeader } from '../../services/formatters';
import { api } from '../../services/api';
import { useScrollCatchUp } from '../../hooks/useScrollCatchUp';
import { NewsCard, type NewsCardData } from './NewsCard';
import { AllCaughtUp } from './AllCaughtUp';
import { CaughtUpOverlay } from './CaughtUpOverlay';
import type { ViewMode } from '../../../ipc-contract';
import './NewsFeed.css';

/** "Something to read in the expanded pane" — a real snippet or a thumbnail, either counts.
 * Shared by DayGroups and ReadArchive so a day's cards don't run long stretches with neither. */
const hasReadableContent = (a: NewsCardData) => !!(a.snippet && a.snippet.trim()) || !!a.imageUrl;

/** Must match main/dataStore.ts's READ_STATE_MAX_AGE_DAYS — that's what actually stops collecting
 * read stories past this point; this is just the label saying so. Expressed in days (not weeks)
 * since that's the unit the underlying prune logic actually uses. */
const READ_ARCHIVE_DAYS = 10;

/** Must match (and comfortably exceed) NewsCard.css's `.news-card__expand` transition duration
 * (0.3s) — see toggleExpand's scroll-into-view logic below for why this can't just be a
 * requestAnimationFrame. */
const CARD_EXPAND_TRANSITION_MS = 340;

interface NewsFeedProps {
  articles: NewsCardData[];
  channelName: string;
  viewMode: ViewMode;
  /** Caps how many unread stories are actually rendered (oldest beyond this are simply held back,
   * not shown anywhere) — the "all caught up" celebration and streak logic still use the true
   * unread count underneath, so this is purely a display limit. Uncapped by default; ChannelPage
   * is the only caller that passes a real value (from settings.maxStoriesShown), since Bookmarks
   * is a deliberate saved list that shouldn't silently hide older entries. */
  maxUnreadStories?: number;
  /** Partition into unread/read with a per-date "read stories" archive and an "all caught up"
   * celebration when unread hits zero — the inbox-style behavior that fits a channel's news feed.
   * Bookmarks are a saved-for-later list, not an inbox to clear, so BookmarksPage opts out and
   * just shows everything flat regardless of read state. */
  partitionByRead?: boolean;
  /** Whether marking a card read removes it from view (with the fly-off animation) instead of
   * leaving it in place with just the dismiss icon flipped to its undo state. Defaults to
   * matching partitionByRead — channel view's inbox behavior removes, Bookmarks' flat list
   * doesn't — but The Pool wants both at once: no archive/celebration (partitionByRead
   * stays false) yet still remove a story once the check button dismisses it, so it passes this
   * explicitly. */
  removeOnRead?: boolean;
  /** Whether unbookmarking a card removes it from view. Defaults to matching partitionByRead too
   * (Bookmarks removes since its whole list IS the bookmarked set; channel view doesn't). The
   * Pool overrides this to false — unlike Bookmarks, unbookmarking there shouldn't empty a
   * general feed just because a save-for-later flag got cleared. */
  removeCardOnUnbookmark?: boolean;
  /** Enables the low-friction catch-up behavior: scrolling a story past the top or opening it marks
   * it read *in place* (dimmed, kept where it is via keepVisible below, rather than swept to the
   * archive), reaching the bottom clears the on-screen stragglers, and hitting zero unread fires
   * the celebration + advances the streak. Defaults to matching partitionByRead (on for channel
   * view, off for Bookmarks); The Pool turns it on explicitly even though it isn't partitioned. */
  catchUpMode?: boolean;
  /** The Pool: keep read stories in the feed (dimmed) instead of dropping them, so the display cap
   * (maxUnreadStories) becomes a cap on the TOTAL number of recent stories shown, read or unread —
   * and the count pill visibly controls it. "Caught up" then means the shown set is all read. */
  showReadDimmed?: boolean;
  /** Builds the brief toast shown after a swipe-dismiss, from the swiped card's own channel name.
   * Defaults to a plain "Story archived." — The Pool overrides this to name the destination
   * channel, since a swipe there otherwise gives no sign of where the story actually went. */
  swipeToastText?: (channelName?: string) => string;
  /** Reports how many stories are currently read-in-place (dimmed, kept in the feed) so a parent
   * can drive a "move all to archive" control's enabled state. */
  onReadInPlaceCountChange?: (count: number) => void;
  /** Set true by the parent right before a manual "clear" (mark-all-read); the next >0→0 unread
   * transition is then treated as a manual clear — no celebration, no streak advance. Consumed
   * (reset to false) once handled. */
  suppressCelebrationRef?: { current: boolean };
  /** Set only when `channelName` is itself a narrower filter (a subchannel) than the whole channel
   * — lets the caught-up celebration offer "Back to {parentChannelName}" to step back out to the
   * unfiltered view. See AllCaughtUp/CaughtUpOverlay, which both take this straight through. */
  parentChannelName?: string;
  onBackToParent?: () => void;
}

/** Imperative handle for parents (ChannelPage's "move read to archive" button). */
export interface NewsFeedHandle {
  /** Files every read-in-place card away at once (to the archive on a channel, out of view in The
   * Pool) by clearing the keep-visible set. */
  flushReadInPlace: () => void;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Grid view: the clicked card itself expands to span every column in place (NewsCard's paneMode
 * prop, see NewsCard.css) — no separate element. CSS Grid's own auto-flow then pushes later cards
 * down to a fresh row on its own; earlier same-row siblings are untouched. List view is
 * untouched — cards there just expand themselves in place, exactly as before.
 *
 * The reflow itself (a card's grid-column changing, and every later card snapping to the row(s)
 * below) can't be smoothly CSS-transitioned — grid placement changes are discrete, not tweenable.
 * Each card gets a stable view-transition-name (only in grid view — list view has no reflow to
 * animate) so the View Transitions API can animate it instead: it snapshots the page before and
 * after the DOM update and cross-fades/morphs matching named elements between the two, which
 * covers both the clicked card's own expand-to-full-width *and* every later card sliding down to
 * its new row, without hand-rolling per-element position math for a variable-length list. */
function GridSection({
  articles,
  isGrid,
  staysInPlace,
  removeCardOnUnbookmark,
  expandedArticleId,
  onToggleExpand,
  readInPlaceIds,
  dimReadCards,
  animateReflow = isGrid,
  onArchiveReadInPlace,
  onLocalExit,
  onSwipeDismissed,
  onLocalUnread,
}: {
  articles: NewsCardData[];
  isGrid: boolean;
  staysInPlace: boolean;
  removeCardOnUnbookmark: boolean;
  expandedArticleId: string | null;
  onToggleExpand: (articleId: string) => void;
  /** Ids passively read this session (NewsFeed's keepVisible) — a card in this set that's read and
   * not currently expanded renders dimmed with the "Read" marker. Undefined outside catch-up mode. */
  readInPlaceIds?: Set<string>;
  /** The Pool: dim EVERY read card (not just this session's), visual-only — its check button just
   * un-reads rather than archiving. */
  dimReadCards?: boolean;
  /** Whether to give cards a view-transition-name for the grid open/close reflow. Defaults to
   * isGrid; the collapsed "Read stories" archive turns it OFF so its (often dozens of) cards don't
   * bloat every transition's snapshot — you don't reflow the main grid against the archive. */
  animateReflow?: boolean;
  onArchiveReadInPlace?: (articleId: string) => void;
  /** See NewsCard's onLocalExit — passed straight through so the main (unread) section can drop a
   * dismissed card from the render set the instant its exit fires, without waiting on a reload. */
  onLocalExit?: (articleId: string) => void;
  /** See NewsCard's onSwipeDismissed — passed straight through so NewsFeed can show its toast. */
  onSwipeDismissed?: (channelName?: string) => void;
  /** See NewsCard's onLocalUnread — passed straight through so an archived card's undo button
   * moves it back to the main section instantly. */
  onLocalUnread?: (articleId: string) => void;
}) {
  const containerClass = isGrid ? 'news-feed__grid' : 'news-feed__list';

  return (
    <div className={containerClass}>
      {articles.map((article) => {
        const isExpanded = expandedArticleId === article.id;
        // Don't dim the card you're actively reading — only collapsed, read cards.
        const readInPlace = !!readInPlaceIds?.has(article.id) && article.read && !isExpanded;
        const dimmed = !!dimReadCards && article.read && !isExpanded;
        return (
          <NewsCard
            key={article.id}
            article={article}
            staysInPlace={staysInPlace}
            removeCardOnUnbookmark={removeCardOnUnbookmark}
            expanded={isExpanded}
            paneMode={isGrid && isExpanded}
            animateReflow={animateReflow}
            readInPlace={readInPlace}
            dimmed={dimmed}
            onArchiveReadInPlace={onArchiveReadInPlace}
            onLocalExit={onLocalExit}
            onSwipeDismissed={onSwipeDismissed}
            onLocalUnread={onLocalUnread}
            onToggleExpand={() => onToggleExpand(article.id)}
          />
        );
      })}
    </div>
  );
}

function DayGroups({
  articles,
  viewMode,
  staysInPlace,
  removeCardOnUnbookmark,
  expandedArticleId,
  onToggleExpand,
  readInPlaceIds,
  dimReadCards,
  onArchiveReadInPlace,
  onLocalExit,
  onSwipeDismissed,
  onLocalUnread,
}: {
  articles: NewsCardData[];
  viewMode: ViewMode;
  staysInPlace: boolean;
  removeCardOnUnbookmark: boolean;
  expandedArticleId: string | null;
  onToggleExpand: (articleId: string) => void;
  readInPlaceIds?: Set<string>;
  dimReadCards?: boolean;
  onArchiveReadInPlace?: (articleId: string) => void;
  onLocalExit?: (articleId: string) => void;
  onSwipeDismissed?: (channelName?: string) => void;
  onLocalUnread?: (articleId: string) => void;
}) {
  const byDay = groupByDay(articles, 'publishedAt');

  return (
    <>
      {[...byDay.entries()].map(([dateKey, dayArticles]) => (
        <section key={dateKey}>
          <div className="news-feed__day-header">{formatDateHeader(dayArticles[0].publishedAt)}</div>
          <GridSection
            articles={intersperseByContent(dayArticles, hasReadableContent)}
            isGrid={viewMode === 'grid'}
            staysInPlace={staysInPlace}
            removeCardOnUnbookmark={removeCardOnUnbookmark}
            expandedArticleId={expandedArticleId}
            onToggleExpand={onToggleExpand}
            readInPlaceIds={readInPlaceIds}
            dimReadCards={dimReadCards}
            onArchiveReadInPlace={onArchiveReadInPlace}
            onLocalExit={onLocalExit}
            onSwipeDismissed={onSwipeDismissed}
            onLocalUnread={onLocalUnread}
          />
        </section>
      ))}
    </>
  );
}

function ReadArchive({
  articles,
  viewMode,
  removeCardOnUnbookmark,
  expandedArticleId,
  onToggleExpand,
  onLocalUnread,
}: {
  articles: NewsCardData[];
  viewMode: ViewMode;
  removeCardOnUnbookmark: boolean;
  expandedArticleId: string | null;
  onToggleExpand: (articleId: string) => void;
  onLocalUnread?: (articleId: string) => void;
}) {
  const byDay = groupByDay(articles, 'publishedAt');
  const [openDate, setOpenDate] = useState<string | null>(null);

  const toggleDate = (dateKey: string) => {
    setOpenDate((prev) => (prev === dateKey ? null : dateKey));
  };

  return (
    <div className="news-feed__archive">
      <div className="news-feed__archive-title">Read stories · {READ_ARCHIVE_DAYS} day archive</div>
      {[...byDay.entries()].map(([dateKey, dayArticles]) => {
        const isOpen = openDate === dateKey;
        return (
          <div key={dateKey} className="news-feed__archive-date">
            <button
              type="button"
              className="news-feed__archive-date-toggle"
              onClick={() => toggleDate(dateKey)}
              aria-expanded={isOpen}
            >
              <ChevronIcon open={isOpen} />
              <span>{formatDateHeader(dayArticles[0].publishedAt)}</span>
              <span className="news-feed__archive-count">{dayArticles.length}</span>
            </button>
            <div className={`news-feed__archive-body ${isOpen ? 'news-feed__archive-body--open' : ''}`}>
              <div className="news-feed__archive-body-inner">
                <div className="news-feed__archive-cards">
                  <GridSection
                    articles={intersperseByContent(dayArticles, hasReadableContent)}
                    isGrid={viewMode === 'grid'}
                    staysInPlace
                    removeCardOnUnbookmark={removeCardOnUnbookmark}
                    expandedArticleId={expandedArticleId}
                    onToggleExpand={onToggleExpand}
                    animateReflow={false}
                    onLocalUnread={onLocalUnread}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const NewsFeed = forwardRef<NewsFeedHandle, NewsFeedProps>(function NewsFeed(
  {
    articles,
    channelName,
    viewMode,
    maxUnreadStories = Infinity,
    partitionByRead = true,
    removeOnRead = partitionByRead,
    removeCardOnUnbookmark = !partitionByRead,
    catchUpMode = partitionByRead,
    showReadDimmed = false,
    swipeToastText = () => 'Story archived.',
    onReadInPlaceCountChange,
    suppressCelebrationRef,
    parentChannelName,
    onBackToParent,
  }: NewsFeedProps,
  ref
) {
  const [justCleared, setJustCleared] = useState(false);
  // Lets the "All caught up" overlay be dismissed with its close button; re-armed whenever unread
  // returns, so the next fresh catch-up celebrates again.
  const [celebrationDismissed, setCelebrationDismissed] = useState(false);
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);
  // Ids cleared *in place* this session by a passive trigger (scroll-past or open). They stay in the
  // main section (dimmed) instead of jumping to the archive, so the list never reflows out from
  // under you mid-scroll. Resets on remount — on your next visit those reads settle into the archive
  // (channel) or drop out (The Pool) naturally, since they're no longer held here.
  const [keepVisible, setKeepVisible] = useState<Set<string>>(() => new Set());
  // Ids whose dismiss/swipe exit has already been committed to locally (see NewsCard's onLocalExit)
  // — dropped from the main section immediately, before the real mutation's network round trip
  // completes, so the gap they leave behind closes instantly instead of sitting empty for however
  // long that round trip takes. Never needs clearing: once the real data reloads without them,
  // membership here just stops mattering.
  const [locallyExited, setLocallyExited] = useState<Set<string>>(() => new Set());
  // Ids whose 'archived' undo button has already been tapped — treated as unread immediately
  // (overriding the real, not-yet-caught-up article.read), so the card moves back to the main
  // section right away instead of sitting in the archive for however long the real mutation's
  // network round trip takes. Pruned once the real data actually catches up (see the effect below)
  // so this can't grow without bound over a long session.
  const [locallyUnread, setLocallyUnread] = useState<Set<string>>(() => new Set());
  // Brief confirmation for a swipe-dismissed card — swiping leaves nothing else on screen to say
  // anything happened once the card itself has flown off, unlike the checkmark button (which has
  // its own click flourish right before the card leaves).
  const [swipeToast, setSwipeToast] = useState<string | null>(null);
  const swipeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUnreadCountRef = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const onLocalExit = useCallback((articleId: string) => {
    setLocallyExited((prev) => {
      if (prev.has(articleId)) return prev;
      const next = new Set(prev);
      next.add(articleId);
      return next;
    });
  }, []);

  const onSwipeDismissed = useCallback(
    (channelName?: string) => {
      if (swipeToastTimerRef.current) clearTimeout(swipeToastTimerRef.current);
      setSwipeToast(swipeToastText(channelName));
      swipeToastTimerRef.current = setTimeout(() => setSwipeToast(null), 1800);
    },
    [swipeToastText]
  );

  const onLocalUnread = useCallback((articleId: string) => {
    setLocallyUnread((prev) => {
      if (prev.has(articleId)) return prev;
      const next = new Set(prev);
      next.add(articleId);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (swipeToastTimerRef.current) clearTimeout(swipeToastTimerRef.current);
    };
  }, []);

  // Once the real data catches up (article.read genuinely false), the override has done its job —
  // drop it so this doesn't just grow forever across a long session.
  useEffect(() => {
    if (locallyUnread.size === 0) return;
    setLocallyUnread((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        const a = articles.find((art) => art.id === id);
        if (!a || !a.read) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // Only re-checking against the current articles matters here, not locallyUnread's own identity
    // (which this effect itself changes) — including it would re-run this on every prune.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles]);

  const byId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  // True read state, with a just-undone card's real (not-yet-caught-up) `read:true` overridden back
  // to unread immediately — see locallyUnread above.
  const isRead = (a: NewsCardData) => a.read && !locallyUnread.has(a.id);

  // articles arrive already sorted newest-first (see articlesCache.getArticles). In showReadDimmed
  // mode (The Pool) the cap covers ALL recent stories (read stay, dimmed); otherwise only unread.
  const baseUnread = !showReadDimmed && (partitionByRead || removeOnRead) ? articles.filter((a) => !isRead(a)) : articles;
  // Intersperse *before* slicing to the cap, not after — groupByDay (used below) always re-sorts
  // each day's own bucket back to pure chronological order, so any interspersing done after grouping
  // can only rearrange whatever already survived this cut. Doing it here means a content-having
  // article that would otherwise be sliced off entirely (behind a long recent-but-empty run from a
  // source like Google News RSS) still makes it into the visible set.
  const cappedBase = intersperseByContent(baseUnread, hasReadableContent).slice(0, maxUnreadStories);
  const cappedBaseIds = useMemo(() => new Set(cappedBase.map((a) => a.id)), [cappedBase]);

  // Main section: the capped unread cards, plus (in catch-up mode) the ones read-in-place this
  // session so they stay put and dimmed — minus anything whose exit already committed locally
  // (see locallyExited above). Filtering `articles` directly keeps chronological order.
  const mainArticles = articles.filter(
    (a) => !locallyExited.has(a.id) && (cappedBaseIds.has(a.id) || (catchUpMode && a.read && keepVisible.has(a.id)))
  );
  // Archive gets read cards that AREN'T being kept in place (i.e. swept away with the check button,
  // or read in a previous session) and haven't just been locally un-archived.
  const archive = partitionByRead ? articles.filter((a) => isRead(a) && !keepVisible.has(a.id)) : [];

  // Source of truth for the celebration + streak. Normally the uncapped unread count (you must clear
  // everything — more slide in under the cap as you go). In showReadDimmed mode (The Pool) the shown
  // set IS capped, so "caught up" means the shown stories are all read — count unread among those.
  // Counts anything in keepVisible/locallyExited as handled even before the server confirms it —
  // both are already-committed local actions (read-in-place, or a dismissed card's exit), so waiting
  // on a network round trip just to notice "you're actually done" would make the celebration lag
  // behind what the screen already shows.
  const trueUnreadCount = showReadDimmed
    ? cappedBase.reduce((n, a) => (isRead(a) || keepVisible.has(a.id) || locallyExited.has(a.id) ? n : n + 1), 0)
    : articles.reduce((n, a) => (isRead(a) || keepVisible.has(a.id) || locallyExited.has(a.id) ? n : n + 1), 0);

  const markReadInPlace = useCallback((articleId: string, channelId: string) => {
    setKeepVisible((prev) => {
      const next = new Set(prev);
      next.add(articleId);
      return next;
    });
    // Deliberately does NOT call revalidateNow(). This runs once per story scrolled past (see
    // useScrollCatchUp's observer) and once per remaining card on reaching the bottom, so a single
    // feed scroll fired dozens of full poll cycles — a large share of the database traffic that
    // eventually exhausted the hosting quota. Nothing is lost by omitting it: setKeepVisible above
    // already updates the screen immediately, and the next ordinary poll reconciles the rest.
    //
    // Guarded — this app has no error boundary, so a throw here (e.g. a stale preload bundle after a
    // main-process change, pre-restart) would otherwise blank the whole app instead of just skipping.
    try {
      void api.markArticleRead(articleId, channelId)?.catch((err) => console.error('[NewsFeed] markRead failed', err));
    } catch (err) {
      console.error('[NewsFeed] markRead failed synchronously', err);
    }
  }, []);

  // Files a single read-in-place card away — drop it from keepVisible so it re-partitions into the
  // archive (channel) or out of view (The Pool). Used by a card's own check button.
  const archiveReadInPlace = useCallback((articleId: string) => {
    setKeepVisible((prev) => {
      if (!prev.has(articleId)) return prev;
      const next = new Set(prev);
      next.delete(articleId);
      return next;
    });
  }, []);

  // Report how many cards are currently read-in-place so ChannelPage can enable/disable its
  // "move read to archive" button. Count only cards actually present + read + kept.
  const readInPlaceCount = catchUpMode
    ? articles.reduce((n, a) => (a.read && keepVisible.has(a.id) ? n + 1 : n), 0)
    : 0;
  useEffect(() => {
    onReadInPlaceCountChange?.(readInPlaceCount);
  }, [readInPlaceCount, onReadInPlaceCountChange]);

  useImperativeHandle(ref, () => ({ flushReadInPlace: () => setKeepVisible(new Set()) }), []);

  const onPassedTop = useCallback(
    (articleId: string) => {
      const a = byId.get(articleId);
      if (a && !a.read) markReadInPlace(a.id, a.channelId);
    },
    [byId, markReadInPlace]
  );

  const onReachedBottom = useCallback(() => {
    // Clear whatever unread is still on screen — the last screenful that never crossed the top.
    for (const a of cappedBase) {
      if (!a.read) markReadInPlace(a.id, a.channelId);
    }
  }, [cappedBase, markReadInPlace]);

  const unreadKey = cappedBase
    .filter((a) => !a.read)
    .map((a) => a.id)
    .join('|');

  useScrollCatchUp({
    containerRef: feedRef,
    enabled: catchUpMode,
    unreadKey,
    onPassedTop,
    onReachedBottom,
  });

  // If the tapped card's top edge is scrolled above the visible area — e.g. it was already
  // partially scrolled past when tapped, only its lower portion in view — opening it left the title
  // and everything above the fold with no way to see them without scrolling up manually first
  // (confirmed live). Brings the card's top back into view instead, offset by the sticky toolbar's
  // real measured height (same [data-sticky-nav] convention as ChannelPage's own title-echo
  // detection and useScrollCatchUp's read-trigger offset) so it doesn't land tucked directly
  // underneath it. A no-op whenever the top is already visible.
  const scrollExpandedCardIntoView = (articleId: string) => {
    const container = feedRef.current;
    const scrollRoot = container?.closest<HTMLElement>('.app-shell__main');
    const cardEl = container?.querySelector<HTMLElement>(`[data-article-id="${CSS.escape(articleId)}"]`);
    if (!scrollRoot || !cardEl) return;
    const navHeight = scrollRoot.querySelector<HTMLElement>('[data-sticky-nav]')?.getBoundingClientRect().height ?? 0;
    const visibleTop = scrollRoot.getBoundingClientRect().top + navHeight + 8;
    const cardTop = cardEl.getBoundingClientRect().top;
    if (cardTop < visibleTop) {
      scrollRoot.scrollBy({ top: cardTop - visibleTop, behavior: 'smooth' });
    }
  };

  const toggleExpand = (articleId: string) => {
    const willOpen = expandedArticleId !== articleId;
    // Opening a card counts as reading it — but marking read fires a data reload, and doing that up
    // front re-renders the feed *during* the open animation, making it stutter. So defer it until
    // after the transition settles (grid) or just run it (list, where there's no reflow to disturb).
    const markReadOnOpen = () => {
      if (!willOpen || !catchUpMode) return;
      const a = byId.get(articleId);
      if (a && !a.read) markReadInPlace(a.id, a.channelId);
    };
    // Runs alongside markReadOnOpen, at the same "settled" point, for the same reason: measuring
    // position before a pending reflow (another card collapsing back down, in grid's case a full
    // view-transition reposition) could read a stale, not-yet-final card position.
    //
    // A single requestAnimationFrame here (the original approach) genuinely wasn't enough: when a
    // DIFFERENT card was already open, switching to this one collapses that one back down at the
    // same time this one opens, and that collapse is a CSS transition — grid-template-rows 0.3s ease
    // (see .news-card__expand in NewsCard.css) — not an instant layout change. One frame in, the
    // collapsing card has barely started shrinking, so the tapped card's measured position was still
    // mid-reflow and would keep drifting for another ~300ms after the scroll already ran. That's
    // exactly why this "usually" didn't work in practice — switching between cards, not opening the
    // very first one, is the common case. CATCH_UP_EXPAND_MS below matches that 0.3s transition
    // (plus a small buffer) so the position is read only after both the open AND any collapse have
    // actually finished settling.
    const settleOnOpen = () => {
      markReadOnOpen();
      if (willOpen) window.setTimeout(() => scrollExpandedCardIntoView(articleId), CARD_EXPAND_TRANSITION_MS);
    };
    const apply = () => setExpandedArticleId((prev) => (prev === articleId ? null : articleId));
    // Only grid view has a reflow worth animating (list view already expands smoothly in place, no
    // grid-column snap involved) — see GridSection's animateReflow/NewsCard's view-transition-name.
    // flushSync forces the state update to commit synchronously inside the callback, which
    // startViewTransition requires to capture an accurate "after" snapshot.
    if (viewMode === 'grid' && document.startViewTransition) {
      const transition = document.startViewTransition(() => flushSync(apply));
      transition.finished.finally(settleOnOpen);
    } else {
      apply();
      settleOnOpen();
    }
  };

  // `justCleared` genuinely needs a normal effect here (not a render-time computation) — this app
  // renders under React.StrictMode, which double-invokes function components in dev, and any
  // render-time approach ends up flip-flopping across the two passes. An effect only fires once per
  // real commit.
  useEffect(() => {
    if (!catchUpMode) return;
    const prevCount = prevUnreadCountRef.current;
    if (prevCount !== null && prevCount > 0 && trueUnreadCount === 0) {
      if (suppressCelebrationRef?.current) {
        // This 0 came from a manual "clear", not from genuinely reading through — no celebration and
        // no streak advance.
        suppressCelebrationRef.current = false;
        setJustCleared(false);
      } else {
        setJustCleared(true);
        // This genuine >0 -> 0 transition is what advances the daily streak (idempotent per calendar
        // day on the main side). Guarded — no error boundary; see markReadInPlace above.
        try {
          void api.recordCatchUp()?.catch((err) => console.error('[NewsFeed] recordCatchUp failed', err));
        } catch (err) {
          console.error('[NewsFeed] recordCatchUp failed synchronously', err);
        }
      }
    } else if (trueUnreadCount > 0) {
      setJustCleared(false);
      setCelebrationDismissed(false);
      // Drop any stale suppress flag once there's unread again, so a later genuine catch-up celebrates.
      if (suppressCelebrationRef) suppressCelebrationRef.current = false;
    }
    prevUnreadCountRef.current = trueUnreadCount;
    // Only the unread count should re-run this — article identity churns constantly on refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchUpMode, trueUnreadCount]);

  const caughtUp = catchUpMode && trueUnreadCount === 0;
  // Nothing left on screen (a fresh visit to an already-clear channel, or after the kept-in-place
  // reads have settled into the archive on remount) → the full-page celebration, as before.
  const showFullCaughtUp = caughtUp && mainArticles.length === 0;

  return (
    <div className="news-feed" ref={feedRef}>
      {showFullCaughtUp ? (
        <AllCaughtUp
          channelName={channelName}
          celebrate={justCleared}
          parentChannelName={parentChannelName}
          onBackToParent={onBackToParent}
        />
      ) : (
        <>
          {/* Just reached zero this session, with the cleared cards still shown dimmed in place —
              float the reward over them instead of replacing the feed. */}
          {caughtUp && mainArticles.length > 0 && !celebrationDismissed && (
            <CaughtUpOverlay
              channelName={channelName}
              onClose={() => setCelebrationDismissed(true)}
              parentChannelName={parentChannelName}
              onBackToParent={onBackToParent}
            />
          )}
          <DayGroups
            articles={mainArticles}
            viewMode={viewMode}
            staysInPlace={!removeOnRead}
            removeCardOnUnbookmark={removeCardOnUnbookmark}
            expandedArticleId={expandedArticleId}
            onToggleExpand={toggleExpand}
            // The Pool dims all read cards (dimReadCards) and its check button un-reads them, so it
            // doesn't use the readInPlace/archive path; channels do the reverse.
            readInPlaceIds={catchUpMode && !showReadDimmed ? keepVisible : undefined}
            dimReadCards={showReadDimmed}
            onArchiveReadInPlace={catchUpMode && !showReadDimmed ? archiveReadInPlace : undefined}
            onLocalExit={onLocalExit}
            onSwipeDismissed={onSwipeDismissed}
            onLocalUnread={onLocalUnread}
          />
        </>
      )}

      {archive.length > 0 && (
        <ReadArchive
          articles={archive}
          viewMode={viewMode}
          removeCardOnUnbookmark={removeCardOnUnbookmark}
          expandedArticleId={expandedArticleId}
          onToggleExpand={toggleExpand}
          onLocalUnread={onLocalUnread}
        />
      )}

      {swipeToast && <div className="news-feed__toast" role="status">{swipeToast}</div>}
    </div>
  );
});
