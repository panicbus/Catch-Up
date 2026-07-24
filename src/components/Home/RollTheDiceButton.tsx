import { useState } from 'react';
import { RollTheDiceModal } from './RollTheDiceModal';
import './RollTheDiceButton.css';

/** Which of the 9 grid cells (1-9, reading left-to-right, top-to-bottom) hold a pip for each value. */
const PIP_CELLS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

/** Pip centre coordinates (in a 32×32 viewBox) for each of the 9 grid cells. */
const PIP_XY: Record<number, [number, number]> = {
  1: [9, 9],
  2: [16, 9],
  3: [23, 9],
  4: [9, 16],
  5: [16, 16],
  6: [23, 16],
  7: [9, 23],
  8: [16, 23],
  9: [23, 23],
};

// Pips are drawn as SVG circles (rather than CSS-grid dots) so every one is exactly the same size
// and pixel-crisp at this tiny render size — CSS sub-pixel rounding otherwise made the centre pip
// look smaller than the corners.
function DieFace({ value, face }: { value: number; face: string }) {
  return (
    <span className={`dice__face dice__face--${face}`}>
      <svg className="dice__pips" viewBox="0 0 32 32" aria-hidden="true">
        {PIP_CELLS[value].map((cell) => {
          const [cx, cy] = PIP_XY[cell];
          return <circle key={cell} cx={cx} cy={cy} r="3.4" fill="#2b2320" />;
        })}
      </svg>
    </span>
  );
}

/** A real 3D die (not a flat flip): four faces around the horizontal axis so that rolling it
 * forward on hover reveals a different pip count on each — front, then bottom, then back, then top.
 * Left/right faces are never seen during a pure x-axis roll, so they aren't drawn. */
function Die() {
  return (
    <span className="dice" aria-hidden="true">
      <span className="dice__cube">
        <DieFace value={3} face="front" />
        <DieFace value={6} face="bottom" />
        <DieFace value={4} face="back" />
        <DieFace value={1} face="top" />
      </span>
    </span>
  );
}

export function RollTheDiceButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="roll-the-dice-button" onClick={() => setOpen(true)}>
        <Die />
        Roll the dice
      </button>
      {open && <RollTheDiceModal onClose={() => setOpen(false)} />}
    </>
  );
}
