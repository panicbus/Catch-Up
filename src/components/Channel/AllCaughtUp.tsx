import { useState } from 'react';
import { BurstEffect } from '../common/BurstEffect';
import './AllCaughtUp.css';

interface AllCaughtUpProps {
  channelName: string;
  /** Only true on the >0→0 unread transition within the same mount — a plain revisit to an
   * already-empty channel shouldn't replay the celebration. */
  celebrate: boolean;
}

export function AllCaughtUp({ channelName, celebrate }: AllCaughtUpProps) {
  const [showBurst, setShowBurst] = useState(celebrate);

  return (
    <div className="all-caught-up">
      <div className="all-caught-up__burst-wrap">
        {showBurst && (
          <BurstEffect angleCount={14} sizeScale={3} durationMs={700} onDone={() => setShowBurst(false)} />
        )}
      </div>
      <div className="all-caught-up__title">All caught up on {channelName}!</div>
      <div className="all-caught-up__body">New stories will show up here automatically.</div>
    </div>
  );
}
