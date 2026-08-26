import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

interface UseSwipeToDismissOptions {
  /** Called once a drag is released past the commit threshold (distance or velocity). */
  onCommit: () => void;
  /** Called on pointerup when the gesture never armed a drag — i.e. a tap/click. */
  onTap: () => void;
  enabled: boolean;
}

export type SwipePhase = 'idle' | 'dragging' | 'committing' | 'springing';

const TAP_SLOP_PX = 8;
const COMMIT_DISTANCE_RATIO = 0.35;
const COMMIT_VELOCITY_PX_MS = 0.5;
const SPRING_BACK_MS = 300;

/** Hand-rolled horizontal swipe-to-dismiss over native Pointer Events — no gesture library.
 * Distinguishes a tap (→ onTap, e.g. expand/collapse) from a horizontal drag (→ onCommit once past
 * a distance-or-velocity threshold, or springs back to center if released short). Vertical drags are
 * released immediately so native scroll still works. */
export function useSwipeToDismiss({ onCommit, onTap, enabled }: UseSwipeToDismissOptions) {
  const [dragX, setDragX] = useState(0);
  const [phase, setPhase] = useState<SwipePhase>('idle');

  const stateRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    pointerId: -1,
    dragging: false,
    axisLocked: false as false | 'x' | 'y',
    cardWidth: 0,
    rafId: 0,
    pendingDx: 0,
  });

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      stateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTime: performance.now(),
        pointerId: e.pointerId,
        dragging: false,
        axisLocked: false,
        cardWidth: rect.width,
        rafId: 0,
        pendingDx: 0,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [enabled]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const s = stateRef.current;
      if (s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;

      if (!s.axisLocked) {
        if (Math.abs(dx) < TAP_SLOP_PX && Math.abs(dy) < TAP_SLOP_PX) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          s.axisLocked = 'x';
          s.dragging = true;
          setPhase('dragging');
        } else {
          // Vertical dominant — this is a scroll, not a swipe. Stop tracking, let native scroll happen.
          s.axisLocked = 'y';
          e.currentTarget.releasePointerCapture(e.pointerId);
          s.pointerId = -1;
          return;
        }
      }

      if (s.axisLocked === 'x') {
        e.preventDefault();
        s.pendingDx = dx;
        if (!s.rafId) {
          s.rafId = requestAnimationFrame(() => {
            setDragX(s.pendingDx);
            s.rafId = 0;
          });
        }
      }
    },
    [enabled]
  );

  const finish = useCallback(
    (_e: ReactPointerEvent<HTMLElement>) => {
      const s = stateRef.current;
      if (s.pointerId === -1) return; // already released as a scroll
      if (s.rafId) {
        cancelAnimationFrame(s.rafId);
        s.rafId = 0;
      }

      if (!s.dragging) {
        setPhase('idle');
        setDragX(0);
        onTap();
        return;
      }

      // s.pendingDx — the last tracked POINTERMOVE position, i.e. what the card was actually
      // rendered following — not a fresh reading of this pointerup/pointercancel event's own
      // clientX. Confirmed as the fix for a real, reported bug: on a fast flick, the coordinate a
      // touchscreen reports at the exact instant of lift-off can genuinely diverge from the
      // trajectory the finger was just visibly tracking (a brief settle/rebound as contact ends),
      // which showed up as exactly this symptom — a fast rightward swipe would occasionally commit
      // (and fly off) LEFT instead, because the release event's own x happened to land back on the
      // wrong side of the start point even though the whole visible drag went right. Judging
      // direction against what the user actually watched the card follow, instead of one final
      // sample the card was never even rendered at, removes that discrepancy entirely.
      const dx = s.pendingDx;
      const dt = Math.max(1, performance.now() - s.startTime);
      const velocity = dx / dt;
      const shouldCommit =
        Math.abs(dx) > COMMIT_DISTANCE_RATIO * s.cardWidth || Math.abs(velocity) > COMMIT_VELOCITY_PX_MS;

      if (shouldCommit) {
        setPhase('committing');
        const direction = dx > 0 ? 1 : -1;
        setDragX(direction * (s.cardWidth + 40));
        onCommit();
      } else {
        setPhase('springing');
        setDragX(0);
        window.setTimeout(() => setPhase('idle'), SPRING_BACK_MS);
      }
    },
    [onCommit, onTap]
  );

  return {
    dragX,
    phase,
    swipeHandlers: enabled
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp: finish,
          onPointerCancel: finish,
        }
      : undefined,
  };
}
