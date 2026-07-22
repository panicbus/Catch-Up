import { useCallback, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { NewBadge } from './NewBadge';
import { PaywallBadge } from './PaywallBadge';
import { DismissButton } from './DismissButton';
import { BookmarkButton } from '../common/BookmarkButton';
import { relativeTime } from '../../services/formatters';
import { api } from '../../services/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';
import { getStoryCardColor } from '../../utils/storyCardColor';
import { getTileColor } from '../../utils/channelColor';
import './NewsCard.css';

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
   * untouched) plus bigger title/image sizing. The width change itself snaps (CSS can't smoothly
   * tween a grid-column span change), but the existing .news-card__expand content reveal
   * (image/read-link) still animates via its usual grid-rows transition, since this is the same
   * already-mounted element, not a freshly-inserted one. */
  paneMode?: boolean;
}

type ExitReason = null | 'read' | 'unbookmark';

const BUTTON_DISMISS_MS = 250;
const SWIPE_DISMISS_MS = 220;

export function NewsCard({
  article,
  expanded,
  onToggleExpand,
  hideDismiss,
  hideNewBadge,
  staysInPlace,
  removeCardOnUnbookmark,
  onBookmarkToggled,
  paneMode,
}: NewsCardProps) {
  const [exitReason, setExitReason] = useState<ExitReason>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const isMobile = useIsMobile();

  const commitDismiss = useCallback(
    (delayMs: number) => {
      window.setTimeout(() => {
        void api.markArticleRead(article.id, article.channelId);
      }, delayMs);
    },
    [article.id, article.channelId]
  );

  const { dragX, phase, swipeHandlers } = useSwipeToDismiss({
    enabled: isMobile && !hideDismiss && !staysInPlace,
    onTap: onToggleExpand,
    onCommit: () => commitDismiss(SWIPE_DISMISS_MS),
  });

  const handleDismissClick = useCallback(() => {
    if (exitReason) return;
    if (article.read) {
      // Already read — undo, don't re-mark. Never animates: undoing never removes a card from
      // its current list (it either stays in place, or moves out of the "read" section, which is
      // handled below by the same staysInPlace check).
      void api.markArticleUnread(article.id, article.channelId);
      return;
    }
    if (staysInPlace) {
      // Stays visible in this list either way — just flip the icon, no fly-off.
      void api.markArticleRead(article.id, article.channelId);
      return;
    }
    setExitReason('read');
    commitDismiss(BUTTON_DISMISS_MS);
  }, [exitReason, article.read, article.id, article.channelId, staysInPlace, commitDismiss]);

  const handleReadFullStory = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.stopPropagation();
      void api.markArticleRead(article.id, article.channelId);
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

  const surfaceProps = swipeHandlers ?? { onClick: onToggleExpand };

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

  const cardStyle = { ...mobileStyle, background: getStoryCardColor(article.id) };

  return (
    <div
      className={`news-card ${paneMode ? 'news-card--pane' : ''} ${exitClass}`}
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={cardStyle}
      {...surfaceProps}
    >
      <div className="news-card__actions">
        {!hideDismiss && (
          <DismissButton onDismiss={handleDismissClick} disabled={!!exitReason} read={article.read} />
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

      {article.channelName && (
        <div className="news-card__channel-label" style={{ color: getTileColor(article.channelId) }}>
          {article.channelName}
        </div>
      )}

      <div className="news-card__top">
        {!hideNewBadge && !article.read && <NewBadge publishedAt={article.publishedAt} />}
        <span className="news-card__title">{article.title}</span>
      </div>

      {article.snippet && (
        <div className={`news-card__snippet ${expanded ? 'news-card__snippet--full' : ''}`}>
          {article.snippet}
        </div>
      )}

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

      <div className="news-card__footer">
        <PaywallBadge paywalled={article.paywalled} />
        {' '}{article.source} · {relativeTime(article.publishedAt)}
      </div>
    </div>
  );
}
