import { useCallback, useState, type MouseEvent, type PointerEvent } from 'react';
import { BurstEffect } from '../common/BurstEffect';
import './DismissButton.css';

/** What clicking the button will do, which drives its icon, animation, and label:
 * - `unread`     — an unread story; click marks it read and it flies off to the archive.
 * - `readInPlace`— read but still shown dimmed in the feed; click files it to the archive.
 * - `archived`   — already in the archive (or a stays-in-place list like Bookmarks); click undoes,
 *                  bringing it back to unread. No flourish, no fly-off. */
export type DismissVariant = 'unread' | 'readInPlace' | 'archived';

interface DismissButtonProps {
  onDismiss: () => void;
  disabled?: boolean;
  variant: DismissVariant;
}

const WAG_MS = 380;

/** Mark-read affordance next to the bookmark button. Present at every viewport width — on mobile
 * it's the accessibility fallback for the swipe gesture. The most deliberate way to clear a story
 * (scrolling past / opening also clear it), so it reads as a proper disc button and gets a
 * satisfying wag + burst when clearing — mirroring the bookmark button's own click flourish. */
export function DismissButton({ onDismiss, disabled, variant }: DismissButtonProps) {
  const [bursting, setBursting] = useState(false);
  const [wagging, setWagging] = useState(false);

  const clearing = variant === 'unread' || variant === 'readInPlace';

  const onClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      if (disabled) return;
      if (clearing) {
        setBursting(true);
        setWagging(true);
        window.setTimeout(() => setWagging(false), WAG_MS);
        // Hold the card in place long enough to see the flourish, then let it fly off.
        window.setTimeout(onDismiss, WAG_MS * 0.55);
      } else {
        onDismiss();
      }
    },
    [disabled, clearing, onDismiss]
  );

  // Stops a press on this button from also arming the parent card's mobile swipe-drag tracking,
  // which begins at pointerdown — click-time stopPropagation alone fires too late for that.
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => e.stopPropagation();

  return (
    <button
      type="button"
      className={`dismiss-button ${variant === 'archived' ? 'dismiss-button--archived' : ''} ${variant === 'readInPlace' ? 'dismiss-button--read' : ''}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label={variant === 'archived' ? 'Mark unread' : variant === 'readInPlace' ? 'Move to archive' : 'Mark read'}
      title={variant === 'archived' ? 'Mark unread' : variant === 'readInPlace' ? 'Move to archive' : 'Mark read'}
      disabled={disabled}
    >
      {bursting && <BurstEffect angleCount={8} sizeScale={0.7} durationMs={460} onDone={() => setBursting(false)} />}
      <span className={`dismiss-button__disc ${wagging ? 'dismiss-button__disc--wag' : ''}`}>
        <svg
          className="dismiss-button__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {variant === 'archived' ? <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /> : <path d="M20 6L9 17l-5-5" />}
        </svg>
      </span>
    </button>
  );
}
