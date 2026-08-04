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

function ManageIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
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
  /** Opens the subchannel manage panel — rendered as the last item in this dropdown (mobile's only
   * access to it; desktop's SubchannelBar keeps its own separate always-visible pill for this). */
  onManageClick: () => void;
}

/** The trigger always reads "Subchannels" (not the active selection) — this is the picker itself,
 * not a value display; a bare "All" or a subchannel's name in its place read like a chip that was
 * already chosen rather than a control to open. Still inert (not just visually disabled —
 * genuinely non-interactive) when the channel has no subchannels, e.g. Art in the mockup, since
 * opening it would offer nothing to pick between; the manage-subchannels entry still needs to be
 * reachable, though, so it always opens straight to the manage panel when it has no other content. */
export function SubchannelPicker({ subchannels, activeId, onSelect, counts, totalUnread = 0, onManageClick }: SubchannelPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasSubchannels = subchannels.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="subchannel-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="subchannel-picker__trigger"
        onClick={() => {
          if (hasSubchannels) setOpen((v) => !v);
          else onManageClick();
        }}
        aria-haspopup="listbox"
        aria-expanded={hasSubchannels && open}
        aria-label="Subchannels"
      >
        Subchannels
        <ChevronIcon />
      </button>
      {hasSubchannels && open && (
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
          <div className="subchannel-picker__divider" />
          <button
            type="button"
            className="subchannel-picker__item subchannel-picker__item--manage"
            onClick={() => {
              setOpen(false);
              onManageClick();
            }}
          >
            <ManageIcon />
            Manage subchannels
          </button>
        </div>
      )}
    </div>
  );
}
