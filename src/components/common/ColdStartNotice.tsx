import { Logo } from '../Layout/Logo';
import './ColdStartNotice.css';

const CENTER = 60;
const OUTER_R = 54;
// 60 marks (one per minute), the 12 that land on an hour drawn longer/thicker — a real clock face's
// tick pattern, not just an outline circle standing in for one (confirmed live: a plain ring read
// as "a circle," not "a clock"). No hands, no numbers, per the original ask.
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const isHour = i % 5 === 0;
  const len = isHour ? 11 : 5;
  const innerR = OUTER_R - len;
  const angle = (i * 6 * Math.PI) / 180; // 0 = 12 o'clock, clockwise
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  return {
    key: i,
    x1: CENTER + innerR * sin,
    y1: CENTER - innerR * cos,
    x2: CENTER + OUTER_R * sin,
    y2: CENTER - OUTER_R * cos,
    width: isHour ? 2.5 : 1.2,
  };
});

/** No hands/numbers, transparent background — a plain outline circle it isn't, this is what makes
 * it actually read as a clock face rather than just a ring the bottle happens to spin inside. */
function ClockFace() {
  return (
    <svg className="cold-start-notice__clock-face" viewBox="0 0 120 120" aria-hidden="true">
      {TICKS.map((t) => (
        <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth={t.width} />
      ))}
    </svg>
  );
}

/** Shown while a gate (OnboardingGate, AuthGate) is waiting on the FIRST network call of the
 * session — the one that can actually hit Render's free-tier cold start (fully suspends after ~15
 * minutes idle; the next request then takes 20-30+ seconds to boot the server back up). Extracted
 * from OnboardingGate, which had this before AuthGate needed the identical thing in front of it. */
export function ColdStartNotice() {
  return (
    <div className="cold-start-notice" role="status">
      <div className="cold-start-notice__clock">
        <ClockFace />
        <div className="cold-start-notice__spinner">
          <Logo size={64} />
        </div>
      </div>
      <p>Waking up the server. This can take up to 30 seconds on the first load.</p>
    </div>
  );
}
