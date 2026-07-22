import { hashString } from './hash';

const STORY_CARD_COUNT = 3;

/** Stable pseudo-random pick from the 3-tone story card palette (--story-card-1/2/3 in
 * variables.css), hashed by article id rather than a positional CSS nth-child cycle — a fixed
 * cycle lines up into visible color columns/rows once the grid is more than one card wide. */
export function getStoryCardColor(articleId: string): string {
  return `var(--story-card-${(hashString(articleId) % STORY_CARD_COUNT) + 1})`;
}
