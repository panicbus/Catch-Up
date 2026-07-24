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
const READ_ARCHIVE_DAYS = 14;

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
  /** Reports how many stories are currently read-in-place (dimmed, kept in the feed) so a parent
   * can drive a "move all to archive" control's enabled state. */
  onReadInPlaceCountChange?: (count: number) => void;
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
}: {
  articles: NewsCardData[];
  viewMode: ViewMode;
  removeCardOnUnbookmark: boolean;
  expandedArticleId: string | null;
  onToggleExpand: (articleId: string) => void;
}) {
  const byDay = groupByDay(articles, 'publishedAt');
  const [openDate, setOpenDate] = useState<string | null>(null);

  const toggleDate = (dateKey: string) => {
    setOpenDate((prev) => (prev === dateKey ? null : dateKey));
  };

  return (
    <div className="news-feed__archive">
      <div className="news-feed__archive-title">Read stories · {READ_ARCHIVE_DAYS / 7} week archive</div>
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
    onReadInPlaceCountChange,
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
  const prevUnreadCountRef = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  // articles arrive already sorted newest-first (see articlesCache.getArticles). In showReadDimmed
  // mode (The Pool) the cap covers ALL recent stories (read stay, dimmed); otherwise only unread.
  const baseUnread =
    !showReadDimmed && (partitionByRead || removeOnRead) ? articles.filter((a) => !a.read) : articles;
  // Intersperse *before* slicing to the cap, not after — groupByDay (used below) always re-sorts
  // each day's own bucket back to pure chronological order, so any interspersing done after grouping
  // can only rearrange whatever already survived this cut. Doing it here means a content-having
  // article that would otherwise be sliced off entirely (behind a long recent-but-empty run from a
  // source like Google News RSS) still makes it into the visible set.
  const cappedBase = intersperseByContent(baseUnread, hasReadableContent).slice(0, maxUnreadStories);
  const cappedBaseIds = useMemo(() => new Set(cappedBase.map((a) => a.id)), [cappedBase]);

  // Main section: the capped unread cards, plus (in catch-up mode) the ones read-in-place this
  // session so they stay put and dimmed. Filtering `articles` directly keeps chronological order.
  const mainArticles = articles.filter(
    (a) => cappedBaseIds.has(a.id) || (catchUpMode && a.read && keepVisible.has(a.id))
  );
  // Archive gets read cards that AREN'T being kept in place (i.e. swept away with the check button,
  // or read in a previous session).
  const archive = partitionByRead ? articles.filter((a) => a.read && !keepVisible.has(a.id)) : [];

  // Source of truth for the celebration + streak. Normally the uncapped unread count (you must clear
  // everything — more slide in under the cap as you go). In showReadDimmed mode (The Pool) the shown
  // set IS capped, so "caught up" means the shown stories are all read — count unread among those.
  const trueUnreadCount = showReadDimmed
    ? cappedBase.reduce((n, a) => (a.read ? n : n + 1), 0)
    : articles.reduce((n, a) => (a.read ? n : n + 1), 0);

  const markReadInPlace = useCallback((articleId: string, channelId: string) => {
    setKeepVisible((prev) => {
      const next = new Set(prev);
      next.add(articleId);
      return next;
    });
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
    const apply = () => setExpandedArticleId((prev) => (prev === articleId ? null : articleId));
    // Only grid view has a reflow worth animating (list view already expands smoothly in place, no
    // grid-column snap involved) — see GridSection's animateReflow/NewsCard's view-transition-name.
    // flushSync forces the state update to commit synchronously inside the callback, which
    // startViewTransition requires to capture an accurate "after" snapshot.
    if (viewMode === 'grid' && document.startViewTransition) {
      const transition = document.startViewTransition(() => flushSync(apply));
      transition.finished.finally(markReadOnOpen);
    } else {
      apply();
      markReadOnOpen();
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
      setJustCleared(true);
      // This genuine >0 -> 0 transition is what advances the daily streak (idempotent per calendar
      // day on the main side). Guarded — no error boundary; see markReadInPlace above.
      try {
        void api.recordCatchUp()?.catch((err) => console.error('[NewsFeed] recordCatchUp failed', err));
      } catch (err) {
        console.error('[NewsFeed] recordCatchUp failed synchronously', err);
      }
    } else if (trueUnreadCount > 0) {
      setJustCleared(false);
      setCelebrationDismissed(false);
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
        <AllCaughtUp channelName={channelName} celebrate={justCleared} />
      ) : (
        <>
          {/* Just reached zero this session, with the cleared cards still shown dimmed in place —
              float the reward over them instead of replacing the feed. */}
          {caughtUp && mainArticles.length > 0 && !celebrationDismissed && (
            <CaughtUpOverlay channelName={channelName} onClose={() => setCelebrationDismissed(true)} />
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
        />
      )}
    </div>
  );
});
