const STORY_CARD_COUNT = 3;

/** Stable pseudo-random pick from the 3-tone story card palette (--story-card-1/2/3 in
 * variables.css), hashed by article id rather than a positional CSS nth-child cycle — a fixed
 * cycle lines up into visible color columns/rows once the grid is more than one card wide. */
export function getStoryCardColor(articleId: string): string {
  let hash = 0;
  for (let i = 0; i < articleId.length; i++) {
    hash = (hash * 31 + articleId.charCodeAt(i)) >>> 0;
  }
  return `var(--story-card-${(hash % STORY_CARD_COUNT) + 1})`;
}
