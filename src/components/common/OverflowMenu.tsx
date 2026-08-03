import { useEffect, useRef, useState } from 'react';
import { PAUSE_OPTIONS, applyPauseChannel } from './PauseChannelControl';
import './OverflowMenu.css';

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

interface OverflowMenuProps {
  channelId: string;
  onMarkAllRead: () => void;
  markAllReadDisabled: boolean;
}

/** Mobile channel header's "…" — holds the two channel-level actions that don't fit in the icon row
 * (Refresh and Back already have their own buttons): Mark all read and Pause. Only ever needs the
 * not-paused case — a paused channel replaces this whole header with ChannelPausedScreen, so there's
 * no "Resume" state to account for here. Modeled directly on PauseChannelControl's own dropdown
 * (open state + outside-click close), and shares its pause options/commit logic rather than
 * duplicating them — see PAUSE_OPTIONS and applyPauseChannel in that file. */
export function OverflowMenu({ channelId, onMarkAllRead, markAllReadDisabled }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="overflow-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="overflow-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="overflow-menu__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="overflow-menu__item"
            disabled={markAllReadDisabled}
            onClick={() => {
              onMarkAllRead();
              setOpen(false);
            }}
          >
            Mark all read
          </button>
          <div className="overflow-menu__divider" />
          <div className="overflow-menu__label">Pause for…</div>
          {PAUSE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitem"
              className="overflow-menu__item"
              onClick={() => {
                applyPauseChannel(channelId, o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
