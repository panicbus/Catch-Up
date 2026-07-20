import { useState } from 'react';
import { SurpriseMeModal } from './SurpriseMeModal';
import './SurpriseMeButton.css';

export function SurpriseMeButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="surprise-me-button" onClick={() => setOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none" />
        </svg>
        Surprise me
      </button>
      {open && <SurpriseMeModal onClose={() => setOpen(false)} />}
    </>
  );
}
