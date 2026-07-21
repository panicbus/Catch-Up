import { useState } from 'react';
import { RollTheDiceModal } from './RollTheDiceModal';
import './RollTheDiceButton.css';

export function RollTheDiceButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="roll-the-dice-button" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="3" y="3" width="14" height="14" rx="4" fill="#ffe08a" />
          <circle cx="7" cy="7" r="1.6" fill="#2b2320" />
          <circle cx="13" cy="13" r="1.6" fill="#2b2320" />
          <circle cx="10" cy="10" r="1.6" fill="#2b2320" />
        </svg>
        Roll the dice
      </button>
      {open && <RollTheDiceModal onClose={() => setOpen(false)} />}
    </>
  );
}
