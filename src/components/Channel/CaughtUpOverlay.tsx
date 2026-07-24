import { useState } from 'react';
import { ConfettiEffect } from '../common/ConfettiEffect';
import './CaughtUpOverlay.css';

/** The "All caught up!" reward — a floating card layered over the just-cleared cards. Confetti
 * bursts once on appearance; a close button dismisses it (it returns on the next fresh catch-up). */
export function CaughtUpOverlay({ channelName, onClose }: { channelName: string; onClose: () => void }) {
  const [confettiDone, setConfettiDone] = useState(false);

  return (
    <div className="caught-up-overlay" aria-live="polite">
      <div className="caught-up-overlay__badge">
        <span className="caught-up-overlay__confetti">
          {!confettiDone && (
            <ConfettiEffect pieceCount={90} durationMs={2500} onDone={() => setConfettiDone(true)} />
          )}
        </span>
        <span className="caught-up-overlay__text">All caught up on {channelName}!</span>
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
      </div>
    </div>
  );
}
