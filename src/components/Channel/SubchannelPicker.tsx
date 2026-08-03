import { useEffect, useRef, useState } from 'react';
import type { Subchannel } from '../../../ipc-contract';
import './SubchannelPicker.css';

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

interface SubchannelPickerProps {
  subchannels: Subchannel[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  /** Same shape as SubchannelBar's — this is the mobile stand-in for that horizontal pill row,
   * which uses flex-wrap and stacks badly at phone width. Same underlying data either way. */
  counts?: Record<string, number>;
  totalUnread?: number;
}

/** Inert (not just visually disabled — genuinely non-interactive) when the channel has no
 * subchannels, e.g. Art in the mockup — there is nothing to pick between. */
export function SubchannelPicker({ subchannels, activeId, onSelect, counts, totalUnread = 0 }: SubchannelPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const disabled = subchannels.length === 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const activeLabel = activeId ? subchannels.find((s) => s.id === activeId)?.name ?? 'All' : 'All';

  return (
    <div className="subchannel-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="subchannel-picker__trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose a subchannel"
      >
        {activeLabel}
        <ChevronIcon />
      </button>
      {open && (
        <div className="subchannel-picker__menu" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={activeId === null}
            className={`subchannel-picker__item ${activeId === null ? 'subchannel-picker__item--active' : ''}`}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          >
            All
            {totalUnread > 0 && <span className="subchannel-picker__count">{totalUnread}</span>}
          </button>
          {subchannels.map((sub) => {
            const count = counts?.[sub.id] ?? 0;
            return (
              <button
                key={sub.id}
                type="button"
                role="option"
                aria-selected={activeId === sub.id}
                className={`subchannel-picker__item ${activeId === sub.id ? 'subchannel-picker__item--active' : ''}`}
                onClick={() => {
                  onSelect(sub.id);
                  setOpen(false);
                }}
              >
                {sub.name}
                {count > 0 && <span className="subchannel-picker__count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
