import { useEffect, useState } from 'react';
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

// Rotated through in order while the wait drags on, so a real cold start (20-30+s) doesn't just
// sit on one static line the whole time. Each entry's duration is how long IT stays up before
// advancing; the last one has no duration because it just holds once reached.
const CAPTION_STAGES: { text: string; note?: string; durationMs?: number }[] = [
  { text: 'Waking up the server...', durationMs: 5000 },
  { text: 'This can take up to 30 seconds on the first load...', durationMs: 5000 },
  { text: 'Almost there...', durationMs: 10000 },
  { text: 'It\'s a necessary evil. Thanks for your patience.', note: 'We appreciate you! ♥️' },
];

// Milliseconds per revealed character — a deliberately unhurried typewriter cadence (fast enough
// that even the longest line finishes well inside its own stage's durationMs, slow enough to
// actually read as being "typed" rather than a blink).
const TYPE_SPEED_MS = 35;

function useCaptionStage(): number {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const duration = CAPTION_STAGES[stage]?.durationMs;
    if (duration === undefined) return;
    const t = window.setTimeout(() => setStage((s) => s + 1), duration);
    return () => window.clearTimeout(t);
  }, [stage]);

  return stage;
}

/** How many characters of `fullText` are revealed so far, ticking up one at a time from 0 —
 * restarts (via the `fullText` dependency) whenever the caption stage changes. Counts with a plain
 * local variable rather than a functional setState updater so the interval doesn't need to read
 * back its own prior render's state each tick. */
function useTypewriter(fullText: string, speedMs: number): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (fullText.length === 0) return;
    let typed = 0;
    const id = window.setInterval(() => {
      typed += 1;
      setCount(typed);
      if (typed >= fullText.length) window.clearInterval(id);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [fullText, speedMs]);

  return count;
}

/** Shown while a gate (OnboardingGate, AuthGate) is waiting on the FIRST network call of the
 * session — the one that can actually hit Render's free-tier cold start (fully suspends after ~15
 * minutes idle; the next request then takes 20-30+ seconds to boot the server back up). Extracted
 * from OnboardingGate, which had this before AuthGate needed the identical thing in front of it. */
export function ColdStartNotice() {
  const stage = useCaptionStage();
  const { text, note } = CAPTION_STAGES[stage];
  // Note types out as a continuation of the main line, not simultaneously with it — one combined
  // counter, split at the boundary between the two, so the note only starts once the line above it
  // has fully appeared (the natural reading order).
  const fullText = text + (note ?? '');
  const typedCount = useTypewriter(fullText, TYPE_SPEED_MS);
  const typedMain = fullText.slice(0, Math.min(typedCount, text.length));
  const typedNote = fullText.slice(text.length, typedCount);
  const stillTyping = typedCount < fullText.length;
  // Whether the still-typing caret belongs at the end of the main line or the note below it — the
  // note is its own display:block span (see .cold-start-notice__caption-note), so a caret placed
  // after it unconditionally would sit on a line of its own beneath an as-yet-empty note block
  // while the main line above is still mid-type, instead of right where the last typed letter is.
  const caretInMain = typedCount <= text.length;

  return (
    <div className="cold-start-notice" role="status">
      <div className="cold-start-notice__clock">
        <ClockFace />
        <div className="cold-start-notice__spinner">
          <Logo size={64} />
        </div>
      </div>
      {/* key={stage} remounts the <p> on every stage change so its fade-in keyframe replays. */}
      <p key={stage} className="cold-start-notice__caption">
        {/* A screen reader gets the full line immediately, not a rolling, self-interrupting
            "letter, letter, letter…" narration of a mutating live region — the typewriter reveal
            below is a purely visual effect, hidden from assistive tech via aria-hidden. */}
        <span className="cold-start-notice__sr-only">
          {text}
          {note}
        </span>
        <span aria-hidden="true">
          {typedMain}
          {stillTyping && caretInMain && <span className="cold-start-notice__caret" />}
          {note && (
            <span className="cold-start-notice__caption-note">
              {typedNote}
              {stillTyping && !caretInMain && <span className="cold-start-notice__caret" />}
            </span>
          )}
        </span>
      </p>
    </div>
  );
}
