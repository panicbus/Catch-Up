import { useEffect, useState } from 'react';
import { ConfettiEffect } from '../common/ConfettiEffect';
import './AllCaughtUp.css';

interface AllCaughtUpProps {
  channelName: string;
  /** Only true on the >0→0 unread transition within the same mount — a plain revisit to an
   * already-empty channel shouldn't replay the celebration. */
  celebrate: boolean;
}

export function AllCaughtUp({ channelName, celebrate }: AllCaughtUpProps) {
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
    </div>
  );
}
