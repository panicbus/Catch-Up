/** Warm hue family copied from the Catch Up Home 2a design doc's example tiles — all
 * L .58–.66 / C .14–.16, varying hue ~12–65 (reds through ambers), matching the ketchup palette
 * rather than spanning the full color wheel. */
const TILE_PALETTE = [
  'oklch(.62 .15 30)',
  'oklch(.60 .16 20)',
  'oklch(.66 .14 65)',
  'oklch(.58 .16 12)',
  'oklch(.64 .14 50)',
  'oklch(.62 .15 40)',
];

/** Stable per-channel color, hashed by id (not array position) so a channel keeps its tile color
 * regardless of reordering or other channels being added/removed. */
export function getTileColor(channelId: string): string {
  let hash = 0;
  for (let i = 0; i < channelId.length; i++) {
    hash = (hash * 31 + channelId.charCodeAt(i)) >>> 0;
  }
  return TILE_PALETTE[hash % TILE_PALETTE.length];
}
