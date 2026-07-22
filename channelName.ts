/** Shared channel-name normalization. Used by both the main process (dataStore's authoritative
 * dedup/creation logic) and the renderer (ChannelSearchBar's "does this channel already exist"
 * pre-check), so the two can't silently disagree about what counts as the same channel name. */

/** Capitalizes the first letter of each word, leaving the rest of each word untouched so acronyms
 * the user already typed correctly (e.g. "NASA", "F1") survive rather than getting lowercased. */
export function capitalizeWords(name: string): string {
  return name
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function slugifyChannelName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
