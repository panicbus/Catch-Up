// Regenerates public/email/logo.png — the ketchup-bottle mark used in the digest email
// (server/digest/render.ts). Not run automatically by any build step: only needs re-running if
// the mark itself changes (see src/components/Layout/Logo.tsx, which this SVG is copied from —
// email HTML can't reference a React component, so this bakes it to a static asset instead).
//
// A real hosted PNG, not inline <svg>: confirmed live that Gmail's HTML sanitizer strips raw
// <svg> elements from email bodies, so the inline version silently rendered as nothing. An <img>
// at a real URL is what Gmail's own image proxy actually fetches and caches.
import sharp from 'sharp';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="92" viewBox="0 0 40 92">
  <rect x="10.5" y="2" width="19" height="9" rx="2.2" fill="#cfd2d4" stroke="#1a1a1a" stroke-width="1.6" />
  <line x1="11.8" y1="7.7" x2="28.2" y2="7.7" stroke="#9aa0a3" stroke-width="1.4" />
  <path d="M13.5 11 L13.5 21 C13.5 28 5 31 5 41 L5 84 Q5 90.5 12 90.5 L28 90.5 Q35 90.5 35 84 L35 41 C35 31 26.5 28 26.5 21 L26.5 11 Z" fill="#c1272d" stroke="#1a1a1a" stroke-width="2.1" stroke-linejoin="round" />
  <path d="M9 51 Q20 46 31 51 L28.5 82 Q20 85.5 11.5 82 Z" fill="#f2f0ec" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round" />
</svg>`;

// 3x the CSS display size (14x32) baked into render.ts's <img> tag, for retina crispness.
await sharp(Buffer.from(SVG), { density: 300 }).resize(120, 276).png().toFile('public/email/logo.png');
console.log('wrote public/email/logo.png');
