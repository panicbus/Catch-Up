interface LogoProps {
  size?: number;
  withWordmark?: boolean;
}

/** Ketchup-bottle mark — same silhouette as build/icon-source.svg, just the bottle, no text or artwork. */
export function Logo({ size = 28, withWordmark = false }: LogoProps) {
  return (
    <span className="logo" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
        <defs>
          <linearGradient id="logo-bottle-gradient" x1="110" y1="170" x2="402" y2="478" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#e4483a" />
            <stop offset="1" stopColor="#c23b2e" />
          </linearGradient>
        </defs>
        <rect x="196" y="48" width="120" height="46" rx="12" fill="#faf6ef" />
        <rect x="196" y="94" width="120" height="18" fill="#c23b2e" />
        <path
          d="M 226 112
             L 286 112
             L 286 170
             C 342 170, 402 200, 402 230
             L 388 460
             Q 386 478, 368 478
             L 144 478
             Q 126 478, 124 460
             L 110 230
             C 110 200, 170 170, 226 170
             Z"
          fill="url(#logo-bottle-gradient)"
        />
        <rect x="126" y="292" width="260" height="78" rx="6" fill="#faf6ef" opacity="0.95" />
      </svg>
      {withWordmark && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: size * 0.62,
            color: 'var(--text)',
          }}
        >
          Catch Up
        </span>
      )}
    </span>
  );
}
