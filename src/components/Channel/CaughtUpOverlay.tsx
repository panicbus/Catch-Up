import { useState } from 'react';
import { ConfettiEffect } from '../common/ConfettiEffect';
import './CaughtUpOverlay.css';

/** The "All caught up!" reward — shown as a floating banner layered *over* the just-cleared cards
 * (which stay visible, dimmed, beneath it) rather than replacing the feed, so nothing gets yanked
 * away at the moment you finish. Confetti bursts once on appearance; the banner itself sticks to the
 * top of the viewport while you remain caught up. Pointer-events pass through so the read cards
 * underneath stay interactive (e.g. to un-read one). */
export function CaughtUpOverlay({ channelName }: { channelName: string }) {
  const [confettiDone, setConfettiDone] = useState(false);

  return (
    <div className="caught-up-overlay" aria-live="polite">
      <div className="caught-up-overlay__badge">
        <span className="caught-up-overlay__confetti">
          {!confettiDone && (
            <ConfettiEffect pieceCount={60} durationMs={2200} onDone={() => setConfettiDone(true)} />
          )}
        </span>
        <span>🎉 All caught up on {channelName}!</span>
      </div>
    </div>
  );
}
