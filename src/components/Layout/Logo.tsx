interface LogoProps {
  /** Icon height in px — the bottle's viewBox is tall/narrow (40x92), so width is derived from
   * this to keep the silhouette proportional, unlike the old square mark. */
  size?: number;
  withWordmark?: boolean;
}

const VIEWBOX_WIDTH = 40;
const VIEWBOX_HEIGHT = 92;

/** Ketchup-bottle mark — outlined/sticker style (from the Catch Up Home 2a design doc), replacing
 * the old smooth-gradient silhouette. Packaged app icons (build/icon*.png/.icns) are separate
 * static assets and intentionally untouched by this. */
export function Logo({ size = 28, withWordmark = false }: LogoProps) {
  const width = size * (VIEWBOX_WIDTH / VIEWBOX_HEIGHT);

  return (
    <span className="logo" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={width} height={size} viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} aria-hidden="true">
        <rect x="10.5" y="2" width="19" height="9" rx="2.2" fill="#cfd2d4" stroke="#1a1a1a" strokeWidth="1.6" />
        <line x1="11.8" y1="7.7" x2="28.2" y2="7.7" stroke="#9aa0a3" strokeWidth="1.4" />
        <path
          d="M13.5 11 L13.5 21 C13.5 28 5 31 5 41 L5 84 Q5 90.5 12 90.5 L28 90.5 Q35 90.5 35 84 L35 41 C35 31 26.5 28 26.5 21 L26.5 11 Z"
          fill="#c1272d"
          stroke="#1a1a1a"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
        <path
          d="M9 51 Q20 46 31 51 L28.5 82 Q20 85.5 11.5 82 Z"
          fill="#f2f0ec"
          stroke="#1a1a1a"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {withWordmark && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: size * 0.585,
            lineHeight: 0.9,
            letterSpacing: '-0.02em',
            color: 'var(--text)',
          }}
        >
          Catch
          <br />
          Up
        </span>
      )}
    </span>
  );
}
