import { memo, useCallback, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { NewBadge } from './NewBadge';
import { PaywallBadge } from './PaywallBadge';
import { DismissButton, type DismissVariant } from './DismissButton';
import { BookmarkButton } from '../common/BookmarkButton';
import { relativeTime } from '../../services/formatters';
import { api, revalidateNow } from '../../services/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';
import { getStoryCardColor } from '../../utils/storyCardColor';
import { getTileColor } from '../../utils/channelColor';
import './NewsCard.css';

// Points down at collapsed cards to invite a tap; points up once expanded, echoing every other
// expand/collapse control in the app (see NewsFeed's read-archive toggle). Distinct from the
// "Read full story ↗" link's arrow on purpose — ↗ means "leaves the app", this means "opens here".
function PreviewChevron() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ReadBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export interface NewsCardData {
  id: string;
  url: string;
  title: string;
  snippet: string | null;
  imageUrl: string | null;
  source: string;
  publishedAt: string;
  paywalled: boolean;
  bookmarked: boolean;
  read: boolean;
  /** Owning channel — every mark-read/bookmark call and the resulting readState/bookmarks
   * broadcast go out under this id, so it must be the article's REAL channel, not a container
   * page's id. Lives on the article itself (rather than a single channelId prop on the feed)
   * specifically so a cross-channel list like The Pool can mix cards from different channels in
   * one feed without misattributing any of their actions. */
  channelId: string;
  /** Shown as a small label in the card's top-left, colored via the same per-channel hash used
   * for Home's tiles. Set by every page (Channel, Bookmarks, The Pool) so a card always names its
   * own channel — most useful where a list mixes channels (Pool always; Bookmarks whenever
   * there's more than one channel's worth of saved stories), but kept consistent everywhere
   * rather than only appearing situationally. */
  channelName?: string;
}

interface NewsCardProps {
  article: NewsCardData;
  /** Controlled expand/collapse — owned by the parent (NewsFeed, or RollTheDiceModal for its single
   * card) so that opening one card can close whichever other card was open. */
  expanded: boolean;
  onToggleExpand: () => void;
  /** Suppresses the dismiss/mark-read button — used by RollTheDiceModal, where "Roll again"/
   * "Close" are already the dismiss-equivalent actions and a mid-modal fly-off-then-blank-card
   * would look broken. Bookmark and expand-to-preview stay available either way. */
  hideDismiss?: boolean;
  /** Suppresses the NEW badge — used by RollTheDiceModal, where every story is being surfaced as
   * a one-off pick rather than browsed from a list, so the "unread inbox" framing doesn't apply
   * and the badge is just unnecessary clutter. */
  hideNewBadge?: boolean;
  /** True when this card's list never removes it based on read state (BookmarksPage, which shows
   * bookmarks regardless of read/unread — see NewsFeed's partitionByRead). Marking read here just
   * flips the dismiss icon to its undo state in place; it must NOT play the fly-off/fade exit
   * animation, since the card isn't actually leaving this list. */
  staysInPlace?: boolean;
  /** True on BookmarksPage, where removing a bookmark removes its card from view — plays the
   * BookmarkButton wag-then-unfill sequence followed by a (slightly longer) card fade-out. */
  removeCardOnUnbookmark?: boolean;
  /** See BookmarkButton's onToggled — only RollTheDiceModal needs this, to patch its own one-off
   * fetched Article since it has no subscription to bookmark-change events. */
  onBookmarkToggled?: (bookmarked: boolean) => void;
  /** Grid view only: true when this card itself is the expanded one — same card, no separate
   * element. Applies grid-column: 1 / -1 so the card spans every column in place (CSS Grid's own
   * auto-flow then pushes later cards down to a fresh row; earlier same-row siblings are
   * untouched) plus bigger title/image sizing. The existing .news-card__expand content reveal
   * (image/read-link) animates via its usual grid-rows transition, since this is the same
   * already-mounted element, not a freshly-inserted one — see animateReflow for the grid-column
   * change itself, which grid-rows can't cover. */
  paneMode?: boolean;
  /** True for every card in a grid-view section (regardless of which one, if any, is expanded) —
   * gives each a stable, unique view-transition-name so NewsFeed's toggleExpand (wrapping the
   * state update in document.startViewTransition) can smoothly animate the reflow: the clicked
   * card growing to full width, and every later card sliding down to its new row, instead of the
   * instant snap a grid-column change can't otherwise be transitioned out of. List view doesn't
   * set this — there's no reflow there to animate. */
  animateReflow?: boolean;
  /** True when this card was cleared *in place* by a passive trigger (scrolled past the top, or
   * opened) rather than swept away with the check button — see NewsFeed's keepVisible set. The card
   * stays put but reads as done: de-emphasized, with a "Read" marker. Distinct from the "Recent"
   * time badge, which is left alone. Only ever set on already-read cards in the main (unread)
   * section, never in the archive. */
  readInPlace?: boolean;
  /** Purely-visual "already read" treatment (dim + "Read" marker), WITHOUT the readInPlace archive
   * semantics — used by The Pool, which shows read stories dimmed in place and whose check button
   * just un-reads them (variant stays 'archived') rather than filing them to an archive it lacks. */
  dimmed?: boolean;
  /** Files a read-in-place card away: plays the fly-off then removes it from the feed (into the
   * archive on a channel, or simply out of view in The Pool). Only meaningful when readInPlace. */
  onArchiveReadInPlace?: (articleId: string) => void;
  /** Fires the instant this card's exit animation is committed to (dismiss click or swipe past the
   * threshold) — before the real API call resolves or any poll picks it up. Lets the parent drop
   * the id from its own local render set right away, so the list collapses the gap immediately
   * instead of waiting on a network round trip. Not fired for the staysInPlace (Bookmarks flip-icon-
   * only) or readInPlace-archive paths, which are already instant/local by their own nature. */
  onLocalExit?: (articleId: string) => void;
}

type ExitReason = null | 'read' | 'unbookmark';

const BUTTON_DISMISS_MS = 250;
const SWIPE_DISMISS_MS = 220;

function NewsCardComponent({
  article,
  expanded,
  onToggleExpand,
  hideDismiss,
  hideNewBadge,
  staysInPlace,
  removeCardOnUnbookmark,
  onBookmarkToggled,
  paneMode,
  animateReflow,
  readInPlace,
  dimmed,
  onArchiveReadInPlace,
  onLocalExit,
}: NewsCardProps) {
  // "Reads as done" visually — either a channel's in-place read (readInPlace, which also makes the
  // check button archive it) or The Pool's plain dimmed-read (dimmed, check button just un-reads).
  const showAsRead = readInPlace || dimmed;
  const [exitReason, setExitReason] = useState<ExitReason>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const isMobile = useIsMobile();

  const commitDismiss = useCallback(
    (delayMs: number) => {
      window.setTimeout(() => {
        onLocalExit?.(article.id);
        void api.markArticleRead(article.id, article.channelId);
        revalidateNow();
      }, delayMs);
    },
    [article.id, article.channelId, onLocalExit]
  );

  // Nothing to reveal by expanding a card with neither a snippet nor a thumbnail — the "Read full
  // story" link renders directly on the card instead (below), so there's no click-to-find-out
  // step. Whether a card CAN expand only depends on its own content, not on staysInPlace/hideDismiss.
  const canExpand = !!(article.snippet || article.imageUrl);

  const { dragX, phase, swipeHandlers } = useSwipeToDismiss({
    enabled: isMobile && !hideDismiss && !staysInPlace,
    onTap: canExpand ? onToggleExpand : () => {},
    onCommit: () => commitDismiss(SWIPE_DISMISS_MS),
  });

  // What the check button means for this card right now (drives its icon/animation and the action).
  const dismissVariant: DismissVariant = !article.read ? 'unread' : readInPlace ? 'readInPlace' : 'archived';

  const handleDismissClick = useCallback(() => {
    if (exitReason) return;
    if (dismissVariant === 'archived') {
      // Undo — bring an already-filed story back to unread. No fly-off (it isn't leaving this list;
      // it either stays put here, or moves out of the archive/read section on the reload).
      void api.markArticleUnread(article.id, article.channelId);
      revalidateNow();
      return;
    }
    if (dismissVariant === 'readInPlace') {
      // Finalize a read-in-place card: fly it off, then hand it back to the feed to file away
      // (archive on a channel; drop from view in The Pool). Already read, so no data change.
      setExitReason('read');
      window.setTimeout(() => onArchiveReadInPlace?.(article.id), BUTTON_DISMISS_MS);
      return;
    }
    // Unread.
    if (staysInPlace) {
      // Stays visible in this list either way (Bookmarks) — just flip the icon, no fly-off.
      void api.markArticleRead(article.id, article.channelId);
      revalidateNow();
      return;
    }
    setExitReason('read');
    commitDismiss(BUTTON_DISMISS_MS);
  }, [exitReason, dismissVariant, article.id, article.channelId, staysInPlace, commitDismiss, onArchiveReadInPlace]);

  const handleReadFullStory = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.stopPropagation();
      void api.markArticleRead(article.id, article.channelId);
      revalidateNow();
    },
    [article.id, article.channelId]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggleExpand();
      }
    },
    [onToggleExpand]
  );

  const surfaceProps = swipeHandlers ?? (canExpand ? { onClick: onToggleExpand } : {});

  const mobileStyle =
    isMobile && phase !== 'idle'
      ? {
          transform: `translateX(${dragX}px)`,
          opacity: phase === 'committing' ? 0 : Math.max(0.3, 1 - Math.abs(dragX) / 300),
          transition: phase === 'dragging' ? 'none' : 'transform 220ms ease-out, opacity 220ms ease-out',
        }
      : undefined;

  const exitClass =
    exitReason === 'read' ? 'news-card--exiting' : exitReason === 'unbookmark' ? 'news-card--exiting-slow' : '';

  const cardStyle = {
    ...mobileStyle,
    background: getStoryCardColor(article.id),
    // Must be unique per element on screen at transition time — keyed by article id like
    // everything else here, so it stays stable across re-renders (same conceptual card) without
    // ever colliding with another card's name.
    ...(animateReflow ? { viewTransitionName: `news-card-${article.id}` } : {}),
  };

  return (
    <div
      className={`news-card ${paneMode ? 'news-card--pane' : ''} ${canExpand ? '' : 'news-card--static'} ${showAsRead ? 'news-card--read-in-place' : ''} ${exitClass}`}
      // Read by useScrollCatchUp's IntersectionObserver: data-article-id identifies which story
      // scrolled past, and data-unread marks which cards it should watch (only ones still unread).
      data-article-id={article.id}
      data-unread={!article.read}
      // Not role="button" — this element wraps other real interactive controls (dismiss,
      // bookmark, "Read full story"), and a button containing more buttons/links is an ARIA
      // anti-pattern (confuses how assistive tech tabs through it). "article" is the correct
      // semantic role for a single story in a feed, and still supports tabIndex/onKeyDown for
      // the click-to-expand affordance without claiming to be an atomic button.
      role="article"
      aria-label={article.title}
      // Not part of the tab order at all when it can't expand — there's nothing for Enter/Space
      // on the card body to do (the read-link and action buttons are already independently
      // reachable via Tab as their own real elements).
      tabIndex={canExpand ? 0 : undefined}
      onKeyDown={canExpand ? onKeyDown : undefined}
      style={cardStyle}
      {...surfaceProps}
    >
      <div className="news-card__actions">
        {/* On mobile, clearing/archiving a card is swipe-only (see useSwipeToDismiss above) — the
            checkmark stays for the 'archived' variant (undoing a story back to unread), which has
            no swipe equivalent and would otherwise be unreachable. Desktop keeps it for every
            variant, same as before. */}
        {!hideDismiss && (!isMobile || dismissVariant === 'archived') && (
          <DismissButton onDismiss={handleDismissClick} disabled={!!exitReason} variant={dismissVariant} />
        )}
        {/* Mobile only: with the checkmark gone, its slot is free — put the "Read" marker there
            instead of its own separate line below, saving a row on every read-in-place card. */}
        {showAsRead && isMobile && (
          <span className="news-card__read-badge news-card__read-badge--inline">
            <ReadBadgeIcon />
            Read
          </span>
        )}
        <BookmarkButton
          articleId={article.id}
          channelId={article.channelId}
          bookmarked={article.bookmarked}
          animateRemoval={removeCardOnUnbookmark}
          onRemoving={() => setExitReason('unbookmark')}
          onToggled={onBookmarkToggled}
        />
      </div>

      {/* Read marker sits top-right, tucked under the action icons — a distinct "you've read this"
          cue, separate from the dimming and from the (unrelated) "Recent" recency badge. Desktop
          only — mobile renders it inline in .news-card__actions above instead (see there). */}
      {showAsRead && !isMobile && (
        <span className="news-card__read-badge">
          <ReadBadgeIcon />
          Read
        </span>
      )}

      {/* Eyebrow: the channel/category label and the "Recent" badge sit together on one line, so
          "Recent" reads as a tag on the category rather than floating by the title. "Recent" is a
          pure recency signal (published < 24h) — NOT gated on read state, so a read-but-still-timely
          story keeps it; read-ness is conveyed separately (dimming + the Read marker). */}
      {(article.channelName || !hideNewBadge) && (
        <div className="news-card__eyebrow">
          {article.channelName && (
            <span className="news-card__channel-label" style={{ color: getTileColor(article.channelId) }}>
              {article.channelName}
            </span>
          )}
          {!hideNewBadge && <NewBadge publishedAt={article.publishedAt} />}
        </div>
      )}

      <div className="news-card__top">
        <span className="news-card__title">{article.title}</span>
      </div>

      {article.snippet && (
        <div className={`news-card__snippet ${expanded ? 'news-card__snippet--full' : ''}`}>
          {article.snippet}
        </div>
      )}

      {canExpand && !expanded && (
        <div className="news-card__preview-hint">
          <PreviewChevron />
          Preview
        </div>
      )}

      {canExpand ? (
        <div className={`news-card__expand ${expanded ? 'news-card__expand--open' : ''}`}>
          <div className="news-card__expand-inner">
            {article.imageUrl && !imageFailed && (
              <img
                className="news-card__image"
                src={article.imageUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
              />
            )}
            <a
              className="news-card__read-link"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleReadFullStory}
            >
              Read full story ↗
            </a>
          </div>
        </div>
      ) : (
        // No snippet, no image — nothing an expand step would reveal, so the link that would
        // otherwise be hidden behind one is just always visible instead. This is the entire point:
        // a card that can't preview its story shouldn't cost a click to find that out.
        <a
          className="news-card__read-link news-card__read-link--standalone"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleReadFullStory}
        >
          Read full story ↗
        </a>
      )}

      <div className="news-card__footer">
        <PaywallBadge paywalled={article.paywalled} />
        {' '}{article.source} · {relativeTime(article.publishedAt)}
      </div>
    </div>
  );
}

/** Memoized so expanding one card in a grid re-renders only the cards whose props actually changed
 * (the opened one and the previously-open one) instead of every card in the feed — that synchronous
 * all-cards re-render inside flushSync was what made the grid open/close transition stutter. The
 * callback props are compared by intent, not identity: they only ever close over this card's own
 * stable id, so a new closure each render doesn't change behavior and shouldn't force a re-render. */
export const NewsCard = memo(NewsCardComponent, (prev, next) => {
  return (
    prev.article === next.article &&
    prev.expanded === next.expanded &&
    prev.paneMode === next.paneMode &&
    prev.animateReflow === next.animateReflow &&
    prev.readInPlace === next.readInPlace &&
    prev.dimmed === next.dimmed &&
    prev.staysInPlace === next.staysInPlace &&
    prev.removeCardOnUnbookmark === next.removeCardOnUnbookmark &&
    prev.hideDismiss === next.hideDismiss &&
    prev.hideNewBadge === next.hideNewBadge
  );
});
