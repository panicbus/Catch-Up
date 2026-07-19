import { useCallback, useState, type CSSProperties, type MouseEvent } from 'react';
import { api } from '../../services/api';
import './BookmarkButton.css';

interface BookmarkButtonProps {
  articleId: string;
  channelId: string;
  bookmarked: boolean;
  variant?: 'overlay' | 'inline';
}

const BURST_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

export function BookmarkButton({ articleId, channelId, bookmarked, variant = 'overlay' }: BookmarkButtonProps) {
  const [bursting, setBursting] = useState(false);

  const onClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      void api.toggleBookmark(articleId, channelId);
      if (!bookmarked) {
        setBursting(true);
        window.setTimeout(() => setBursting(false), 550);
      }
    },
    [articleId, channelId, bookmarked]
  );

  return (
    <button
      type="button"
      className={`bookmark-button ${variant === 'inline' ? 'bookmark-button--inline' : ''}`}
      onClick={onClick}
      aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this story'}
      aria-pressed={bookmarked}
    >
      {bursting && (
        <span className="bookmark-burst" aria-hidden>
          {BURST_ANGLES.map((angle) => (
            <span
              key={angle}
              className="bookmark-burst__line"
              style={{ '--angle': `${angle}deg` } as CSSProperties}
            />
          ))}
        </span>
      )}
      <svg
        className="bookmark-button__icon"
        viewBox="0 0 24 24"
        fill={bookmarked ? 'var(--accent)' : 'none'}
        stroke={bookmarked ? 'var(--accent)' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1z" />
      </svg>
    </button>
  );
}
