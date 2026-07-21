import { useCallback, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { api } from '../../services/api';
import { BurstEffect } from './BurstEffect';
import './BookmarkButton.css';

interface BookmarkButtonProps {
  articleId: string;
  channelId: string;
  bookmarked: boolean;
  variant?: 'overlay' | 'inline';
  /** Plays a wag-then-unfill sequence on removal, and delays the actual unbookmark call until
   * `onRemoving` (i.e. the caller's own exit animation) has had time to run — used on BookmarksPage,
   * where removing a bookmark removes its card from the list and the data change can't be allowed
   * to arrive before that card's fade-out finishes playing. Elsewhere, removal is instant. */
  animateRemoval?: boolean;
  /** Fires once the wag+unfill has played, right before the (delayed) real toggle call — the signal
   * for the parent card to start its own fade-out in sync. Only meaningful with animateRemoval. */
  onRemoving?: () => void;
  /** Fires with the new bookmarked state right as a plain (non-animateRemoval) toggle is dispatched.
   * Most callers don't need this — the `bookmarked` prop already comes from a hook that's subscribed
   * to bookmark-change events and re-renders on its own. It exists for the one place that isn't:
   * RollTheDiceModal holds a single ad-hoc `Article` fetched once via getRandomArticle, with no
   * subscription, so without this its bookmark icon would silently go stale after a click. */
  onToggled?: (bookmarked: boolean) => void;
}

const WAG_MS = 450;
export const BOOKMARK_REMOVE_CARD_FADE_MS = 380;

export function BookmarkButton({
  articleId,
  channelId,
  bookmarked,
  variant = 'overlay',
  animateRemoval,
  onRemoving,
  onToggled,
}: BookmarkButtonProps) {
  const [bursting, setBursting] = useState(false);
  const [wagging, setWagging] = useState(false);
  const [forceUnfilled, setForceUnfilled] = useState(false);
  const removing = useRef(false);

  const onClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      if (removing.current) return;

      if (bookmarked && animateRemoval) {
        removing.current = true;
        setWagging(true);
        window.setTimeout(() => {
          setWagging(false);
          setForceUnfilled(true);
          onRemoving?.();
          window.setTimeout(() => {
            void api.toggleBookmark(articleId, channelId);
          }, BOOKMARK_REMOVE_CARD_FADE_MS);
        }, WAG_MS);
        return;
      }

      void api.toggleBookmark(articleId, channelId);
      if (!bookmarked) setBursting(true);
      onToggled?.(!bookmarked);
    },
    [articleId, channelId, bookmarked, animateRemoval, onRemoving, onToggled]
  );

  // Stops a press on this button from also arming the parent card's mobile swipe-drag tracking,
  // which begins at pointerdown — click-time stopPropagation alone fires too late for that.
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => e.stopPropagation();

  const showFilled = bookmarked && !forceUnfilled;

  return (
    <button
      type="button"
      className={`bookmark-button ${variant === 'inline' ? 'bookmark-button--inline' : ''}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label={showFilled ? 'Remove bookmark' : 'Bookmark this story'}
      aria-pressed={showFilled}
    >
      {bursting && <BurstEffect onDone={() => setBursting(false)} />}
      <svg
        className={`bookmark-button__icon ${wagging ? 'bookmark-button__icon--wagging' : ''}`}
        viewBox="0 0 24 24"
        fill={showFilled ? 'var(--accent)' : 'none'}
        stroke={showFilled ? 'var(--accent)' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1z" />
      </svg>
    </button>
  );
}
