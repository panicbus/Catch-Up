import { useEffect, useRef, useState } from 'react';
import { isNewArticle } from '../../utils/isNew';
import { useIsMobile } from '../../hooks/useIsMobile';
import './NewBadge.css';

const HOVER_DELAY_MS = 500;

/** The "Recent" badge — a purely time-based marker (published < 24h ago), shown regardless of
 * read state. Internal name/CSS classes stay `NewBadge`/`new-badge` (the visible label changed
 * from "NEW" to "Recent") to avoid churning the grid-view positioning rules that key off them. */
export function NewBadge({ publishedAt }: { publishedAt: string }) {
  const isMobile = useIsMobile();
  const [hovering, setHovering] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Desktop only: delay-gated so the tooltip doesn't flash on every incidental mouse-pass over a
  // card. Mobile has no hover to wait on, so it skips this entirely — see the tap handler below.
  useEffect(() => {
    if (isMobile) return;
    if (!hovering) {
      setShowTooltip(false);
      return;
    }
    const timer = window.setTimeout(() => setShowTooltip(true), HOVER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hovering, isMobile]);

  // Mobile: opens instantly on tap instead of waiting out the hover delay (there's no hover to
  // wait on), and closes on a tap anywhere outside the badge since there's no hover-away either.
  useEffect(() => {
    if (!isMobile || !showTooltip) return;
    const onOutside = (e: MouseEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setShowTooltip(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [isMobile, showTooltip]);

  if (!isNewArticle(publishedAt)) return null;

  return (
    <span
      ref={wrapRef}
      className="new-badge-wrap"
      onMouseEnter={() => !isMobile && setHovering(true)}
      onMouseLeave={() => !isMobile && setHovering(false)}
      onClick={(e) => {
        if (!isMobile) return;
        e.stopPropagation();
        setShowTooltip((v) => !v);
      }}
      // Stops a tap here from also arming the card's mobile swipe-drag tracking (which begins at
      // pointerdown and would otherwise treat this as a tap-to-expand on the card underneath) —
      // see DismissButton for the same fix and why click-time stopPropagation alone is too late.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="new-badge">Recent</span>
      {showTooltip && (
        <span className="new-badge__tooltip" role="tooltip">
          Published less than 24 hours ago
        </span>
      )}
    </span>
  );
}
