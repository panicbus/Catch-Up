/** Hints only — never gates freeform subchannel entry. Matched loosely against the parent channel name. */
const SUGGESTION_MAP: Array<{ match: RegExp; suggestions: string[] }> = [
  { match: /music|band|artist/i, suggestions: ['Rock', 'Pop', 'Hip-Hop', 'Jazz'] },
  { match: /sport|team/i, suggestions: ['Scores', 'Trades', 'Injuries', 'Draft'] },
  { match: /tech|technology/i, suggestions: ['AI', 'Startups', 'Hardware', 'Security'] },
  { match: /movie|film|tv|television/i, suggestions: ['Reviews', 'Box Office', 'Streaming', 'Awards'] },
  { match: /politic/i, suggestions: ['Elections', 'Policy', 'Congress', 'Local'] },
  { match: /finance|market|stock|invest/i, suggestions: ['Stocks', 'Crypto', 'Economy', 'Earnings'] },
  { match: /food|cooking/i, suggestions: ['Recipes', 'Restaurants', 'Trends'] },
  { match: /science/i, suggestions: ['Space', 'Health', 'Climate', 'Research'] },
];

export function suggestSubchannels(channelName: string): string[] {
  const hit = SUGGESTION_MAP.find((entry) => entry.match.test(channelName));
  return hit ? hit.suggestions : [];
}
