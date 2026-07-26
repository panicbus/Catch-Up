import { Button } from '../common/Button';
import './ChannelPausedScreen.css';

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}

/** Full-pane "on a break" takeover shown while a channel is paused — the channel view is grayed out
 * and only the Resume button (and this notice) are actionable. */
export function ChannelPausedScreen({
  name,
  pausedUntil,
  onResume,
}: {
  name: string;
  pausedUntil: string | null;
  onResume: () => void;
}) {
  // Indefinite pauses use a far-future sentinel date (see dataStore PAUSE_FOREVER_UNTIL).
  const indefinite = !!pausedUntil && new Date(pausedUntil).getFullYear() >= 9000;
  return (
    <div className="channel-paused">
      <div className="channel-paused__card">
        <div className="channel-paused__icon">
          <PauseGlyph />
        </div>
        <h2 className="channel-paused__title">Taking a break from {name}</h2>
        <p className="channel-paused__sub">{indefinite ? 'until I say so' : 'for a while'}</p>
        <Button variant="success" onClick={onResume}>
          Resume {name}
        </Button>
      </div>
    </div>
  );
}
