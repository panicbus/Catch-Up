import { useEffect, useMemo, type CSSProperties } from 'react';
import './ConfettiEffect.css';

interface ConfettiEffectProps {
  pieceCount?: number;
  durationMs?: number;
  onDone?: () => void;
}

/** Brand reds/oranges plus a few festive extras — pure brand-only would read as "the app's red
 * button exploded," not a celebration. */
const COLORS = ['#e4483a', '#f2874a', '#ffe08a', '#57c25b', '#4a9cff', '#c23b2e'];

/** Confetti explosion — bigger, more festive celebration than BurstEffect's radiating lines
 * (which stays as-is for the smaller bookmark-save acknowledgment). Positions are precomputed in
 * JS with plain Math.cos/sin (rather than relying on CSS trig functions) so each piece's flight
 * path is just a played keyframe — mounting starts it, it owns its own lifetime like BurstEffect. */
export function ConfettiEffect({ pieceCount = 50, durationMs = 1400, onDone }: ConfettiEffectProps) {
  useEffect(() => {
    if (!onDone) return;
    const timer = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, onDone]);

  const pieces = useMemo(
    () =>
      Array.from({ length: pieceCount }, (_, i) => {
        const angle = Math.random() * Math.PI * 2;
        const distance = 90 + Math.random() * 150;
        const fall = 50 + Math.random() * 80;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance * 0.6 - 20 + fall;
        const rotate = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720);
        const delay = Math.random() * 150;
        const width = 5 + Math.random() * 5;
        const height = width * (1.3 + Math.random() * 0.6);
        return {
          id: i,
          dx,
          dy,
          rotate,
          delay,
          width,
          height,
          round: Math.random() < 0.4,
          color: COLORS[i % COLORS.length],
        };
      }),
    [pieceCount]
  );

  return (
    <span className="confetti" aria-hidden style={{ '--confetti-duration': `${durationMs}ms` } as CSSProperties}>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti__piece"
          style={
            {
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rotate': `${p.rotate}deg`,
              '--delay': `${p.delay}ms`,
              width: `${p.width}px`,
              height: `${p.height}px`,
              background: p.color,
              borderRadius: p.round ? '50%' : '2px',
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
