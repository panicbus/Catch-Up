import { useEffect, useState } from 'react';
import { ConfettiEffect } from '../common/ConfettiEffect';
import './AllCaughtUp.css';

interface AllCaughtUpProps {
  channelName: string;
  /** Only true on the >0→0 unread transition within the same mount — a plain revisit to an
   * already-empty channel shouldn't replay the celebration. */
  celebrate: boolean;
  /** Set only when the caller is viewing a subchannel (a filter narrower than the whole channel)
   * — "Back to {parentChannelName}" clears that filter. Undefined everywhere else (Bookmarks, The
   * Pool, or a channel's own "All" view), which has no narrower filter to step back out of. */
  parentChannelName?: string;
  onBackToParent?: () => void;
}

export function AllCaughtUp({ channelName, celebrate, parentChannelName, onBackToParent }: AllCaughtUpProps) {
  const [showConfetti, setShowConfetti] = useState(false);

  // Reacts to `celebrate` via an effect rather than a `useState(celebrate)` initializer — the
  // latter only applies on this component's very first render, so it would silently miss a
  // `celebrate` that flips true shortly after mount instead of already being true on arrival
  // (which is the normal case here — see NewsFeed's own effect for why this lag exists).
  useEffect(() => {
    if (celebrate) setShowConfetti(true);
  }, [celebrate]);

  return (
    <div className="all-caught-up">
      <div className="all-caught-up__celebration-wrap">
        {showConfetti && <ConfettiEffect pieceCount={50} durationMs={2100} onDone={() => setShowConfetti(false)} />}
      </div>
      <div className="all-caught-up__title">All caught up in {channelName}!</div>
      <div className="all-caught-up__body">New stories will show up here automatically.</div>
      {parentChannelName && onBackToParent && (
        <button type="button" className="all-caught-up__back" onClick={onBackToParent}>
          ← Back to {parentChannelName}
        </button>
      )}
    </div>
  );
}
