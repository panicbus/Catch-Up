/** Pure, Electron-agnostic — same portability contract as the rest of this folder (see gazetteer.ts).
 *
 * Companion to relevance.ts's Politics hard exclude: that gate decides keep-or-reject per article,
 * exempting a detected foreign country when a sibling subchannel names it (gate.politicsExemptCountryCodes)
 * rather than rejecting it outright — but exempting isn't the same as placing it. An exempted article
 * still needs to end up in the RIGHT bucket (the matching subchannel, not the main feed it happened to
 * be fetched under), and relevance.ts's gate has no notion of "which bucket," only "keep or reject" —
 * that's what this module does, as a separate step runChannel runs on the main target's own survivors
 * right after filterRelevant returns them (see main/refreshAgent.ts and server/refreshAgent.ts).
 *
 * No channel in this app has ever pulled content out of its own main/"All" view before today — every
 * other subchannel is purely a filtered VIEW onto the same shared pool, still visible in the parent's
 * main feed too. This is the one deliberate exception, scoped to Politics specifically. */

import type { FetchedArticle } from '../providers/types';
import { detectStoryCountry } from './placeExtraction';
import { subchannelCountryCode } from './gazetteer';

export interface RoutedArticles {
  /** Home-country or no-place-detected stories — unchanged from what filterRelevant already decided,
   * merged under subchannelId: null exactly as before this feature existed. */
  main: FetchedArticle[];
  /** A detected foreign country matching one of the channel's own subchannels, keyed by that
   * subchannel's real id — merge each group under its OWN id instead of null. */
  toSubchannel: Map<string, FetchedArticle[]>;
}

/** Partitions a Politics-category channel's MAIN-target survivors (subchannelId: null) by detected
 * country. Only ever called for the main target — a subchannel-specific target already merges under
 * its own real subchannel id, so there's nothing to route for it.
 *
 * A foreign country with no matching subchannel isn't expected to appear in `articles` at all —
 * relevance.ts's hard exclude already rejected it before filterRelevant returned — but if one does
 * (e.g. subchannel list changed between the gate running and this call), it's dropped here rather
 * than leaking into `main`, the same outcome the hard exclude intended. */
export function routeByCountry(
  articles: FetchedArticle[],
  homeCountryCode: string,
  subchannels: readonly { id: string; name: string }[]
): RoutedArticles {
  const subchannelIdByCountry = new Map<string, string>();
  for (const sc of subchannels) {
    const cc = subchannelCountryCode(sc.name);
    // First subchannel to claim a given country wins — two subchannels naming the same country is a
    // degenerate configuration nothing in the UI actually offers a path to today.
    if (cc && !subchannelIdByCountry.has(cc)) subchannelIdByCountry.set(cc, sc.id);
  }

  const main: FetchedArticle[] = [];
  const toSubchannel = new Map<string, FetchedArticle[]>();
  for (const article of articles) {
    const place = detectStoryCountry(article.title, article.snippet, homeCountryCode);
    const subchannelId = place.kind === 'foreign' ? subchannelIdByCountry.get(place.countryCode) : undefined;
    if (place.kind === 'foreign' && !subchannelId) continue; // no matching subchannel — drop, see above
    if (subchannelId) {
      const list = toSubchannel.get(subchannelId);
      if (list) list.push(article);
      else toSubchannel.set(subchannelId, [article]);
    } else {
      main.push(article);
    }
  }
  return { main, toSubchannel };
}
