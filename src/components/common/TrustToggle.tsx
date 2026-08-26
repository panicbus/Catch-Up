import type { MouseEvent, PointerEvent } from 'react';
import './TrustToggle.css';

interface TrustToggleProps {
  /** The article's own sourceDomain — also the value saved into/removed from
   * Settings.trustedSourceDomains, and the same value relevance.ts matches against. */
  domain: string;
  trusted: boolean;
  onToggle: (domain: string) => void;
}

/** A small star next to a card's source name (see NewsCard's footer) — marks that publisher as
 * trusted, a mild boost in relevance.ts's scoring (see W.trustedSource). Styling/interaction
 * pattern mirrors BookmarkButton: stopPropagation on both click and pointerdown so a tap here
 * neither expands the card nor arms its mobile swipe-drag tracking (which begins at pointerdown,
 * so click-time stopPropagation alone would fire too late for it). */
export function TrustToggle({ domain, trusted, onToggle }: TrustToggleProps) {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onToggle(domain);
  };
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => e.stopPropagation();

  return (
    <button
      type="button"
      className="trust-toggle"
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label={trusted ? `Untrust ${domain}` : `Trust ${domain}`}
      aria-pressed={trusted}
      title={trusted ? 'Trusted source: its stories rank higher' : 'Mark this source as trusted'}
    >
      <svg
        viewBox="0 0 20 20"
        className="trust-toggle__icon"
        fill={trusted ? 'var(--accent)' : 'none'}
        stroke={trusted ? 'var(--accent)' : 'currentColor'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 2.5l2.15 4.53 4.85.68-3.5 3.46.85 4.93L10 13.77l-4.35 2.33.85-4.93-3.5-3.46 4.85-.68z" />
      </svg>
    </button>
  );
}
