import { useEffect, useRef, useState } from 'react';
import { ConfettiEffect } from '../common/ConfettiEffect';
import './CaughtUpOverlay.css';

/** How long the caught-up notice lingers before auto-dismissing. The timer bar fills over this same
 * duration so the countdown is visible. */
const DISMISS_MS = 4000;

interface CaughtUpOverlayProps {
  channelName: string;
  onClose: () => void;
  /** See AllCaughtUp's identical props — set only when viewing a subchannel. */
  parentChannelName?: string;
  onBackToParent?: () => void;
}

/** The "All caught up!" reward — a floating card layered over the just-cleared cards. Confetti
 * bursts once on appearance; it auto-dismisses after DISMISS_MS (with a filling timer bar), and the
 * close button dismisses it early. It returns on the next fresh catch-up. */
export function CaughtUpOverlay({ channelName, onClose, parentChannelName, onBackToParent }: CaughtUpOverlayProps) {
  const [confettiDone, setConfettiDone] = useState(false);

  // Auto-dismiss once, DISMISS_MS after mount. A ref keeps us on the latest onClose without the
  // timer resetting each time the parent re-renders and passes a new onClose identity.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => onCloseRef.current(), DISMISS_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="caught-up-overlay" aria-live="polite">
      <div className="caught-up-overlay__badge">
        <span className="caught-up-overlay__confetti">
          {!confettiDone && (
            <ConfettiEffect pieceCount={90} durationMs={2500} onDone={() => setConfettiDone(true)} />
          )}
        </span>
        <span className="caught-up-overlay__text-col">
          <span className="caught-up-overlay__text">All caught up in {channelName}!</span>
          {parentChannelName && onBackToParent && (
            <button type="button" className="caught-up-overlay__back" onClick={onBackToParent}>
              ← Back to {parentChannelName}
            </button>
          )}
        </span>
        <button
          type="button"
          className="caught-up-overlay__close"
          onClick={onClose}
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {/* Countdown bar — fills left→right over DISMISS_MS, then the notice auto-dismisses. */}
        <span
          className="caught-up-overlay__timer"
          style={{ animationDuration: `${DISMISS_MS}ms` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
