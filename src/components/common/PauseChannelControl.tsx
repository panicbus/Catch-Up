import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import './PauseChannelControl.css';

const OPTIONS: { label: string; hours: number }[] = [
  { label: '24 hours', hours: 24 },
  { label: '48 hours', hours: 48 },
  { label: '1 week', hours: 168 },
];

export function isChannelPaused(pausedUntil: string | null | undefined): boolean {
  return !!pausedUntil && new Date(pausedUntil).getTime() > Date.now();
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

interface Props {
  channelId: string;
  pausedUntil: string | null;
  /** `button` = labelled button (channel page); `icon` = compact icon-only (home tiles). */
  variant?: 'button' | 'icon';
}

/** Pause a channel's auto-refresh for 24h / 48h / 1 week, or resume it. Renders a small dropdown of
 * durations when active, and a one-tap Resume when paused. Buttons stopPropagation/preventDefault so
 * the control works inside a clickable tile (a Link) without navigating. */
export function PauseChannelControl({ channelId, pausedUntil, variant = 'button' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const paused = isChannelPaused(pausedUntil);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const pause = (e: React.MouseEvent, hours: number) => {
    stop(e);
    void api.setChannelPause(channelId, hours);
    setOpen(false);
  };
  const resume = (e: React.MouseEvent) => {
    stop(e);
    void api.setChannelPause(channelId, null);
    setOpen(false);
  };

  if (paused) {
    return (
      <button
        type="button"
        className={`pause-control pause-control--${variant} pause-control--paused`}
        onClick={resume}
        title="Paused — click to resume"
        aria-label="Resume channel"
      >
        <PlayIcon />
        {variant === 'button' && <span>Resume</span>}
      </button>
    );
  }

  return (
    <div className="pause-control-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`pause-control pause-control--${variant}`}
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
        }}
        title="Pause channel"
        aria-label="Pause channel"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PauseIcon />
        {variant === 'button' && <span>Pause</span>}
      </button>
      {open && (
        <div className="pause-control__menu" role="menu">
          <div className="pause-control__menu-label">Pause for…</div>
          {OPTIONS.map((o) => (
            <button
              key={o.hours}
              type="button"
              role="menuitem"
              className="pause-control__menu-item"
              onClick={(e) => pause(e, o.hours)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
