import { useEffect, useRef, useState } from 'react';
import './StreakCard.css';

const PROGRESS_SEGMENTS = 5;

/** The flame grows with the streak: a small single flame at 1 day, incrementally bigger each day,
 * biggest at 5 (and capped there — see FLAME_MAX_LEVEL). Scaled from its base so it grows upward,
 * with a brighter inner core for depth. */
const FLAME_MAX_LEVEL = 5;

function FlameIcon({ level }: { level: number }) {
  const lvl = Math.min(Math.max(level, 1), FLAME_MAX_LEVEL);
  const scale = 0.66 + (lvl - 1) * 0.105; // ~0.66 at day 1 → ~1.08 at day 5+
  // Once the flame is maxed out (5+ days), it's "on fire" — a gentle pulsing ember glow marks it.
  const glowing = level >= FLAME_MAX_LEVEL;
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden="true"
      className={`streak-card__flame ${glowing ? 'streak-card__flame--glow' : ''}`}
    >
      <g style={{ transformOrigin: '10px 17px', transform: `scale(${scale})` }}>
        <path d="M10 3c4 4 4 8 0 14-4-6-4-10 0-14z" fill="#ff9d2e" />
        <path d="M10 8c2 2 2 4 0 7-2-3-2-5 0-7z" fill="#ffe08a" />
      </g>
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5" strokeLinecap="round" />
      <circle cx="10" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
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
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tooltipOpen) return;
    const onOutsideEvent = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setTooltipOpen(false);
        return;
      }
      if (e.target instanceof Node && !wrapperRef.current?.contains(e.target)) setTooltipOpen(false);
    };
    document.addEventListener('mousedown', onOutsideEvent);
    document.addEventListener('keydown', onOutsideEvent);
    return () => {
      document.removeEventListener('mousedown', onOutsideEvent);
      document.removeEventListener('keydown', onOutsideEvent);
    };
  }, [tooltipOpen]);

  return (
    <div className="streak-card" key={current}>
      <div className="streak-card__info-wrapper" ref={wrapperRef}>
        <button
          type="button"
          className="streak-card__info"
          aria-label="How the streak works"
          aria-expanded={tooltipOpen}
          aria-describedby="streak-card-tooltip"
          onClick={() => setTooltipOpen((v) => !v)}
        >
          <InfoIcon />
        </button>
        {tooltipOpen && (
          <div className="streak-card__tooltip" id="streak-card-tooltip" role="tooltip">
            Counts days you caught up on a channel (clearing its unread stories to zero). Skip a
            day and it resets. You're at a {current}-day streak right now.
          </div>
        )}
      </div>
      <div className="streak-card__row">
        <FlameIcon level={current} />
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
