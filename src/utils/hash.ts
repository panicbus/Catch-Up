/** Stable string hash (djb2-ish, 31-multiplier variant) used anywhere a value needs a
 * deterministic-but-scattered pick from a fixed palette/bucket count, keyed by id rather than
 * array position — a positional cycle lines up into visible columns/rows once a grid is more
 * than one item wide. Shared by channelColor.ts, storyCardColor.ts, and (a standalone copy of
 * the same logic, since main/renderer are separate compile targets) main/refreshAgent.ts. */
export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}
