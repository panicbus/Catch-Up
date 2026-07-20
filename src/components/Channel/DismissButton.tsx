import type { MouseEvent, PointerEvent } from 'react';
import './DismissButton.css';

interface DismissButtonProps {
  onDismiss: () => void;
  disabled?: boolean;
  /** When true, this card is already read (shown in the collapsed "read stories" section) —
   * the button becomes an undo control instead of a dismiss control. */
  read?: boolean;
}

/** Mark-read affordance next to the bookmark button. Present at every viewport width — on mobile
 * it's the accessibility fallback for the swipe gesture, which has no keyboard equivalent. */
export function DismissButton({ onDismiss, disabled, read }: DismissButtonProps) {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) return;
    onDismiss();
  };

  // Stops a press on this button from also arming the parent card's mobile swipe-drag tracking,
  // which begins at pointerdown — click-time stopPropagation alone fires too late for that.
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => e.stopPropagation();

  return (
    <button
      type="button"
      className="dismiss-button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label={read ? 'Mark unread' : 'Mark read'}
      disabled={disabled}
    >
      <svg
        className="dismiss-button__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {read ? (
          <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
        ) : (
          <path d="M20 6L9 17l-5-5" />
        )}
      </svg>
    </button>
  );
}
