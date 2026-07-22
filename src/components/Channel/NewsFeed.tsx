import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { groupByDay } from '../../utils/groupByDay';
import { intersperseByContent } from '../../utils/intersperseByContent';
import { formatDateHeader } from '../../services/formatters';
import { api } from '../../services/api';
import { NewsCard, type NewsCardData } from './NewsCard';
import { AllCaughtUp } from './AllCaughtUp';
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
   * doesn't — but The Pool wants both at once: no archive/celebration/streak (partitionByRead
   * stays false) yet still remove a story once you've read it, so it passes this explicitly. */
  removeOnRead?: boolean;
  /** Whether unbookmarking a card removes it from view. Defaults to matching partitionByRead too
   * (Bookmarks removes since its whole list IS the bookmarked set; channel view doesn't). The
   * Pool overrides this to false — unlike Bookmarks, unbookmarking there shouldn't empty a
   * general feed just because a save-for-later flag got cleared. */
  removeCardOnUnbookmark?: boolean;
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
}: {
  articles: NewsCardData[];
  isGrid: boolean;
  staysInPlace: boolean;
  removeCardOnUnbookmark: boolean;
  expandedArticleId: string | null;
  onToggleExpand: (articleId: string) => void;
}) {
  const containerClass = isGrid ? 'news-feed__grid' : 'news-feed__list';

  return (
    <div className={containerClass}>
      {articles.map((article) => {
        const isExpanded = expandedArticleId === article.id;
        return (
          <NewsCard
            key={article.id}
            article={article}
            staysInPlace={staysInPlace}
            removeCardOnUnbookmark={removeCardOnUnbookmark}
            expanded={isExpanded}
            paneMode={isGrid && isExpanded}
            animateReflow={isGrid}
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
}: {
  articles: NewsCardData[];
  viewMode: ViewMode;
  staysInPlace: boolean;
  removeCardOnUnbookmark: boolean;
  expandedArticleId: string | null;
  onToggleExpand: (articleId: string) => void;
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

export function NewsFeed({
  articles,
  channelName,
  viewMode,
  maxUnreadStories = Infinity,
  partitionByRead = true,
  removeOnRead = partitionByRead,
  removeCardOnUnbookmark = !partitionByRead,
}: NewsFeedProps) {
  const [justCleared, setJustCleared] = useState(false);
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);
  const prevUnreadCountRef = useRef<number | null>(null);

  // `unread` is the true count, used for the celebration/streak logic below — articles arrive
  // already sorted newest-first (see articlesCache.getArticles). Filtered whenever either
  // partitionByRead or removeOnRead wants read articles gone from the main section — The Pool
  // sets removeOnRead alone (partitionByRead stays false, so this is still the only section
  // rendered, never an archive).
  const unread = partitionByRead || removeOnRead ? articles.filter((a) => !a.read) : articles;
  // Intersperse *before* slicing to the cap, not after — groupByDay (used below) always re-sorts
  // each day's own bucket back to pure chronological order, so any interspersing done after
  // grouping can only rearrange whatever already survived this cut. Doing it here instead means a
  // content-having article that would otherwise be sliced off entirely (behind a long recent-but-
  // empty run from a source like Google News RSS) gets pulled into the visible set at all — the
  // per-day intersperse in DayGroups/ReadArchive then just distributes it well within its day.
  const visibleUnread = intersperseByContent(unread, hasReadableContent).slice(0, maxUnreadStories);
  const read = partitionByRead ? articles.filter((a) => a.read) : [];

  const toggleExpand = (articleId: string) => {
    const apply = () => setExpandedArticleId((prev) => (prev === articleId ? null : articleId));
    // Only grid view has a reflow worth animating (list view already expands smoothly in place,
    // no grid-column snap involved) — see GridSection's animateReflow/NewsCard's view-transition-
    // name. flushSync forces the state update (and its DOM effects) to commit synchronously
    // inside the callback, which startViewTransition requires to capture an accurate "after"
    // snapshot — React's normal batching would otherwise let the callback return before the DOM
    // actually reflects the new state.
    if (viewMode === 'grid' && document.startViewTransition) {
      document.startViewTransition(() => flushSync(apply));
    } else {
      apply();
    }
  };

  // `justCleared` genuinely needs a normal effect here (not a render-time computation) — this
  // app renders under React.StrictMode, which double-invokes function components in dev, and any
  // render-time approach (mutating a ref, or even calling setState conditionally during render)
  // ends up flip-flopping across the two passes and committing the wrong value. An effect avoids
  // that: it only fires once per real commit. The one-render lag this introduces (AllCaughtUp
  // mounts with celebrate=false, then gets updated to celebrate=true on the next render) is fine
  // as long as AllCaughtUp actually reacts to that later prop change — see its own effect.
  useEffect(() => {
    if (!partitionByRead) return;
    const prevCount = prevUnreadCountRef.current;
    if (prevCount !== null && prevCount > 0 && unread.length === 0) {
      setJustCleared(true);
      // This genuine >0 -> 0 transition is what advances the daily streak — not merely opening
      // the app (see dataStore.recordCatchUp). Idempotent per calendar day on the main side.
      // Guarded: this app has no error boundary, so an uncaught throw here (e.g. a stale preload
      // bundle missing this IPC method after a main-process change, before a restart) would
      // otherwise blank the entire app instead of just silently skipping the streak bump.
      try {
        void api.recordCatchUp()?.catch((err) => console.error('[NewsFeed] recordCatchUp failed', err));
      } catch (err) {
        console.error('[NewsFeed] recordCatchUp failed synchronously', err);
      }
    } else if (unread.length > 0) {
      setJustCleared(false);
    }
    prevUnreadCountRef.current = unread.length;
    // Only the unread count should re-run this — article identity churns constantly on refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partitionByRead, unread.length]);

  return (
    <div className="news-feed">
      {partitionByRead && unread.length === 0 ? (
        <AllCaughtUp channelName={channelName} celebrate={justCleared} />
      ) : (
        <DayGroups
          articles={visibleUnread}
          viewMode={viewMode}
          staysInPlace={!removeOnRead}
          removeCardOnUnbookmark={removeCardOnUnbookmark}
          expandedArticleId={expandedArticleId}
          onToggleExpand={toggleExpand}
        />
      )}

      {read.length > 0 && (
        <ReadArchive
          articles={read}
          viewMode={viewMode}
          removeCardOnUnbookmark={removeCardOnUnbookmark}
          expandedArticleId={expandedArticleId}
          onToggleExpand={toggleExpand}
        />
      )}
    </div>
  );
}
