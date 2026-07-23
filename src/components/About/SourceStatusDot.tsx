import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { ProviderStatus } from '../../../ipc-contract';

// Same hover/tap-reveal interaction as NewsCard's NewBadge tooltip: delayed on desktop hover so it
// doesn't flash on an incidental mouse-pass, instant on mobile tap since there's no hover to wait on.
const HOVER_DELAY_MS = 500;

function statusLabel(p: ProviderStatus): string {
  if (p.rateLimited) return 'Rate limited, pausing for a bit';
  return p.configured ? 'Configured' : 'Not configured';
}

export function SourceStatusDot({ provider }: { provider: ProviderStatus }) {
  const isMobile = useIsMobile();
  const [hovering, setHovering] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isMobile) return;
    if (!hovering) {
      setShowTooltip(false);
      return;
    }
    const timer = window.setTimeout(() => setShowTooltip(true), HOVER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hovering, isMobile]);

  useEffect(() => {
    if (!isMobile || !showTooltip) return;
    const onOutside = (e: MouseEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setShowTooltip(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [isMobile, showTooltip]);

  return (
    <span
      ref={wrapRef}
      className="about-page__source-dot-wrap"
      onMouseEnter={() => !isMobile && setHovering(true)}
      onMouseLeave={() => !isMobile && setHovering(false)}
      onClick={() => isMobile && setShowTooltip((v) => !v)}
    >
      <span
        className={`about-page__source-dot ${
          provider.rateLimited
            ? 'about-page__source-dot--warn'
            : provider.configured
              ? 'about-page__source-dot--on'
              : ''
        }`}
      />
      {showTooltip && (
        <span className="about-page__source-tooltip" role="tooltip">
          {statusLabel(provider)}
        </span>
      )}
    </span>
  );
}
