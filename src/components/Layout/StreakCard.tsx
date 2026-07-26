import { useEffect, useRef, useState } from 'react';
import './StreakCard.css';

const PROGRESS_SEGMENTS = 5;

/** The fire builds with the streak: a single small flame at 1 day that grows and sprouts side
 * flames into a full multi-flame fire by day 5 (capped there — see FLAME_MAX_LEVEL). At the full
 * 5-day fire the flames flicker (see .streak-card__fire--flicker in the CSS). Twice the old size. */
const FLAME_MAX_LEVEL = 5;

function FlameIcon({ level }: { level: number }) {
  const lvl = Math.min(Math.max(level, 1), FLAME_MAX_LEVEL);
  const t = (lvl - 1) / (FLAME_MAX_LEVEL - 1); // 0 at day 1 → 1 at day 5
  const full = level >= FLAME_MAX_LEVEL;

  // Grow each flame from its base; side flames emerge after the first day or so. When full, the
  // CSS flicker animation drives the transforms instead, so we leave them unset here.
  const centerScaleY = 0.6 + 0.4 * t;
  const sideScaleY = 0.45 + 0.55 * t;
  const sideOpacity = Math.max(0, Math.min(1, (t - 0.15) / 0.85));
  const sideStyle = full ? undefined : { transform: `scaleY(${sideScaleY})`, opacity: sideOpacity };

  return (
    <svg
      viewBox="0 0 44 44"
      width="40"
      height="40"
      aria-hidden="true"
      className={`streak-card__fire ${full ? 'streak-card__fire--flicker' : ''}`}
    >
      <g className="streak-card__flame streak-card__flame--left" style={sideStyle}>
        <path d="M13 23 C 16.5 27, 16.5 32, 13 40 C 9.5 32, 9.5 27, 13 23 Z" fill="#ff7a1a" />
      </g>
      <g className="streak-card__flame streak-card__flame--right" style={sideStyle}>
        <path d="M31 23 C 34.5 27, 34.5 32, 31 40 C 27.5 32, 27.5 27, 31 23 Z" fill="#ff7a1a" />
      </g>
      <g className="streak-card__flame streak-card__flame--center" style={full ? undefined : { transform: `scaleY(${centerScaleY})` }}>
        <path d="M22 8 C 30 17, 30 26, 22 40 C 14 26, 14 17, 22 8 Z" fill="#ff9d2e" />
        <path d="M22 19 C 26 24, 26 30, 22 36 C 18 30, 18 24, 22 19 Z" fill="#ffe08a" />
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
