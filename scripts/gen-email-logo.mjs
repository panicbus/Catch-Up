// Regenerates public/email/logo.png — the FULL digest-email header lockup: the ketchup-bottle mark
// plus the "Catch Up" wordmark, as one image (server/digest/render.ts). Not run automatically by any
// build step: only needs re-running if the mark or wordmark changes (see src/components/Layout/
// Logo.tsx, which both are copied from — email HTML can't reference a React component, so this bakes
// them to a static asset instead).
//
// Why the whole lockup and not just the bottle: the wordmark used to be real HTML text next to the
// bottle image, which meant it rendered in whatever default font the mail client had — the app's own
// display face (Fraunces) can't be used there, because mainstream email clients (Gmail especially)
// don't load webfonts. Baking the text into the image is the only way it actually looks like the app.
//
// Why a real hosted PNG and not inline <svg>: confirmed live that Gmail's HTML sanitizer strips raw
// <svg> elements from email bodies, so an inline version silently rendered as nothing. An <img> at a
// real URL is what Gmail's own image proxy actually fetches and caches.
//
// The wordmark is converted to VECTOR PATHS via fontkit rather than left as SVG <text>: that would
// require Fraunces to be installed on whatever machine runs this AND require the renderer to resolve
// its variable-weight axis correctly, neither of which is true here (Fraunces is loaded from Google
// Fonts at runtime in the app, and isn't a system font). Paths sidestep both — the output is
// identical regardless of what's installed locally.
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import sharp from 'sharp';

// Matches Logo.tsx's 'inline' wordmark layout exactly.
const ICON_HEIGHT = 32; // CSS display height, also the <img> height in render.ts
const ICON_VIEWBOX_W = 40;
const ICON_VIEWBOX_H = 92;
const GAP = 10;
const FONT_SIZE = ICON_HEIGHT * 0.8;
const LETTER_SPACING_EM = -0.02;
const TEXT = 'Catch Up';
const TEXT_COLOR = '#1a1a1a';
const SCALE = 3; // render at 3x the CSS size for retina crispness

const FONT_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf';

async function loadFont() {
  const cached = join(tmpdir(), 'catchup-fraunces.ttf');
  if (!existsSync(cached)) {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`Failed to download Fraunces: ${res.status}`);
    writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  const font = fontkit.openSync(cached);
  // Fraunces ships as a variable font; the app renders the wordmark at weight 900 (Logo.tsx), which
  // is a named axis position, not the default instance — without pinning it here the text would come
  // out at regular weight.
  return font.getVariation({ wght: 900, opsz: 144, SOFT: 0, WONK: 0 });
}

const font = await loadFont();
const unitScale = FONT_SIZE / font.unitsPerEm;
const run = font.layout(TEXT);

// Glyph outlines, laid out left to right with the font's own kerning plus Logo.tsx's letter-spacing.
let penX = 0;
const glyphPaths = [];
run.glyphs.forEach((glyph, i) => {
  const d = glyph.path.toSVG();
  if (d) glyphPaths.push(`<path d="${d}" transform="translate(${penX} 0) scale(${unitScale} ${-unitScale})" />`);
  penX += run.positions[i].xAdvance * unitScale + FONT_SIZE * LETTER_SPACING_EM;
});
// Trailing letter-spacing isn't real width — it sits after the last glyph.
const textWidth = penX - FONT_SIZE * LETTER_SPACING_EM;

const iconWidth = ICON_HEIGHT * (ICON_VIEWBOX_W / ICON_VIEWBOX_H);
const totalWidth = iconWidth + GAP + textWidth;
// Optically centered on cap height rather than the full em box, matching how the browser centers the
// wordmark against the bottle in Logo.tsx's flex row.
const baselineY = (ICON_HEIGHT + font.capHeight * unitScale) / 2;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${ICON_HEIGHT}" viewBox="0 0 ${totalWidth} ${ICON_HEIGHT}">
  <g transform="scale(${ICON_HEIGHT / ICON_VIEWBOX_H})">
    <rect x="10.5" y="2" width="19" height="9" rx="2.2" fill="#cfd2d4" stroke="#1a1a1a" stroke-width="1.6" />
    <line x1="11.8" y1="7.7" x2="28.2" y2="7.7" stroke="#9aa0a3" stroke-width="1.4" />
    <path d="M13.5 11 L13.5 21 C13.5 28 5 31 5 41 L5 84 Q5 90.5 12 90.5 L28 90.5 Q35 90.5 35 84 L35 41 C35 31 26.5 28 26.5 21 L26.5 11 Z" fill="#c1272d" stroke="#1a1a1a" stroke-width="2.1" stroke-linejoin="round" />
    <path d="M9 51 Q20 46 31 51 L28.5 82 Q20 85.5 11.5 82 Z" fill="#f2f0ec" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round" />
  </g>
  <g fill="${TEXT_COLOR}" transform="translate(${iconWidth + GAP} ${baselineY})">
    ${glyphPaths.join('\n    ')}
  </g>
</svg>`;

await sharp(Buffer.from(SVG), { density: 72 * SCALE })
  .resize(Math.round(totalWidth * SCALE), Math.round(ICON_HEIGHT * SCALE))
  .png()
  .toFile('public/email/logo.png');

console.log(
  `wrote public/email/logo.png — display size ${Math.round(totalWidth)}x${ICON_HEIGHT} (rendered ${SCALE}x)`
);
