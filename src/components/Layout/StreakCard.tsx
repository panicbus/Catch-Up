import './StreakCard.css';

const PROGRESS_SEGMENTS = 5;

function FlameIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M10 3c4 4 4 8 0 14-4-6-4-10 0-14z" fill="#ffe08a" />
    </svg>
  );
}

interface StreakCardProps {
  current: number;
}

/** Brand-colored gradient card, fixed across themes (same treatment as the accent "Roll the
 * dice" button) — meant to pop the same way in light and dark mode rather than blend in. */
export function StreakCard({ current }: StreakCardProps) {
  const filled = Math.min(current, PROGRESS_SEGMENTS);

  return (
    <div className="streak-card" key={current}>
      <div className="streak-card__row">
        <FlameIcon />
        <span className="streak-card__count">{current}</span>
        <span className="streak-card__label">day streak</span>
      </div>
      <div className="streak-card__progress">
        {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
          <i key={i} className={i < filled ? 'streak-card__segment--filled' : ''} />
        ))}
      </div>
    </div>
  );
}
