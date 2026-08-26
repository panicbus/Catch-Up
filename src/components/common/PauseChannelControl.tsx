import { useEffect, useRef, useState } from 'react';
import { api, revalidateNow } from '../../services/api';
import * as channelsStore from '../../services/channelsStore';
import './PauseChannelControl.css';

/** Exported for the mobile channel-page overflow menu (OverflowMenu.tsx), which offers the same
 * pause durations inline rather than through this component's own dropdown — one definition either
 * way, so the two entry points can't drift on labels or values. */
export const PAUSE_OPTIONS: { label: string; value: number | 'forever' }[] = [
  { label: '24 hours', value: 24 },
  { label: '48 hours', value: 48 },
  { label: '1 week', value: 168 },
  { label: 'Until I say so', value: 'forever' },
];

// Mirrors server/stores/dataStore.ts's setChannelPause exactly (PAUSE_FOREVER_UNTIL and
// pauseLabelForHours) — the optimistic patch has to match the server's actual output byte-for-byte
// (note pausedLabel is lowercase 'until I say so', not the capitalized menu label above) or the
// paused badge visibly changes text the moment revalidation lands.
const PAUSE_FOREVER_UNTIL = '9999-12-31T00:00:00.000Z';
function pauseLabelForHours(hours: number): string {
  if (hours === 24) return '24 hours';
  if (hours === 48) return '48 hours';
  if (hours === 168) return '1 week';
  return `${hours} hours`;
}

function optimisticPause(value: number | 'forever' | null): { pausedUntil: string | null; pausedLabel: string | null } {
  if (value === null) return { pausedUntil: null, pausedLabel: null };
  if (value === 'forever') return { pausedUntil: PAUSE_FOREVER_UNTIL, pausedLabel: 'until I say so' };
  return { pausedUntil: new Date(Date.now() + value * 3600_000).toISOString(), pausedLabel: pauseLabelForHours(value) };
}

/** The one place a pause/resume actually gets applied — exported so OverflowMenu.tsx's inline
 * duration list commits through the exact same optimistic-mutate path as this component's own
 * dropdown, rather than a second copy that could drift. */
export function applyPauseChannel(channelId: string, value: number | 'forever' | null): void {
  const patch = optimisticPause(value);
  channelsStore
    .mutate(
      (prev) => prev.map((c) => (c.id === channelId ? { ...c, ...patch } : c)),
      () => api.setChannelPause(channelId, value)
    )
    .then(() => revalidateNow())
    .catch(() => {});
}

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
  const pause = (e: React.MouseEvent, value: number | 'forever') => {
    stop(e);
    applyPauseChannel(channelId, value);
    setOpen(false);
  };
  const resume = (e: React.MouseEvent) => {
    stop(e);
    applyPauseChannel(channelId, null);
    setOpen(false);
  };

  if (paused) {
    return (
      <button
        type="button"
        className={`pause-control pause-control--${variant} pause-control--paused`}
        onClick={resume}
        title="Paused, click to resume"
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
          {PAUSE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitem"
              className="pause-control__menu-item"
              onClick={(e) => pause(e, o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
