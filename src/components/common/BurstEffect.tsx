import { useEffect, type CSSProperties } from 'react';
import './BurstEffect.css';

interface BurstEffectProps {
  angleCount?: number;
  sizeScale?: number;
  durationMs?: number;
  onDone?: () => void;
}

/** Radiating-lines celebration burst — used by BookmarkButton on save, and by AllCaughtUp
 * (bigger/slower) when a channel's unread stack hits zero. Mounting starts it; it owns its own
 * lifetime and calls onDone when finished, so the caller just conditionally renders it. */
export function BurstEffect({ angleCount = 8, sizeScale = 1, durationMs = 500, onDone }: BurstEffectProps) {
  useEffect(() => {
    if (!onDone) return;
    const timer = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, onDone]);

  const angles = Array.from({ length: angleCount }, (_, i) => (360 / angleCount) * i);

  return (
    <span
      className="burst"
      aria-hidden
      style={{ '--scale': sizeScale, '--burst-duration': `${durationMs}ms` } as CSSProperties}
    >
      {angles.map((angle) => (
        <span key={angle} className="burst__line" style={{ '--angle': `${angle}deg` } as CSSProperties} />
      ))}
    </span>
  );
}
