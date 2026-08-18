/** Decides which of a user's channels (and subchannels) a batch of custom-source articles actually
 * belongs in — the "sort into the right channel" half of the feature. A custom source has no topic
 * search narrowing its results the way every other provider's does (it's fetched once per user, not
 * once per channel — see refresh.ts), so this is what stands in for that: the SAME heuristic gate
 * every other provider's results already go through (main/providers/relevance.ts), run once per
 * channel/subchannel against the whole batch, reusing relevance.ts's own extra-strictness for loose
 * sources (see isLooseProvider there) so a general feed can't slide an off-topic story into a channel
 * on a technicality.
 *
 * Deliberately heuristic-only, not the AI-classification layer (main/aiRelevance.ts) — that layer
 * costs real API calls against a user's own daily cap, and running it for every channel × every
 * custom article every round would multiply that cost in a way a user adding a couple of sources
 * wouldn't expect. The heuristic gate alone is exactly what already makes the Google News RSS
 * fallback usable without AI, and custom sources get the identical strict treatment.
 *
 * Subchannels are checked BEFORE a channel's own lenient main feed, not after — the existing
 * per-target refresh loop happens to check channel-then-subchannels (see refreshAgent.ts), but that
 * ordering exists only because the channel-level search legitimately runs first there. A custom
 * source has no such "which search found it first" signal, so this orders it the way a user actually
 * wants: a story specific enough to name a subchannel lands there, not just in the parent channel's
 * general list. */

import { filterByRelevance, type RelevanceContext } from '../../main/providers/relevance';
import { channelProfile } from '../../main/providers/channelProfiles';
import type { FetchedArticle } from '../../main/providers/types';
import type { Channel } from '../../ipc-contract';

export interface CustomSourcePlacement {
  channelId: string;
  subchannelId: string | null;
  articles: FetchedArticle[];
}

function asSearchPhrase(name: string): string {
  const trimmed = name.trim();
  return trimmed.includes(' ') ? `"${trimmed}"` : trimmed;
}

export function sortCustomArticles(
  articles: FetchedArticle[],
  channels: Pick<Channel, 'id' | 'name' | 'subchannels'>[],
  homeLocation: RelevanceContext['homeLocation'],
  trustedSourceDomains: RelevanceContext['trustedSourceDomains'] = []
): CustomSourcePlacement[] {
  const placements: CustomSourcePlacement[] = [];

  for (const channel of channels) {
    const profile = channelProfile(channel.name);
    // Keyed by URL, not article id — sortCustomArticles runs before articleId() assigns a real id
    // (see refresh.ts), so URL is the only stable identity available at this point.
    const claimedUrls = new Set<string>();

    for (const sub of channel.subchannels) {
      const candidates = articles.filter((a) => !claimedUrls.has(a.url));
      if (candidates.length === 0) break; // nothing left unclaimed for this channel at all
      const ctx: RelevanceContext = {
        topic: `${asSearchPhrase(channel.name)} ${asSearchPhrase(sub.name)}`,
        channelName: channel.name,
        subchannelName: sub.name,
        profile,
        homeLocation,
        trustedSourceDomains,
      };
      const kept = filterByRelevance(candidates, ctx);
      if (kept.length === 0) continue;
      placements.push({ channelId: channel.id, subchannelId: sub.id, articles: kept });
      for (const a of kept) claimedUrls.add(a.url);
    }

    const remaining = articles.filter((a) => !claimedUrls.has(a.url));
    if (remaining.length === 0) continue;
    const mainCtx: RelevanceContext = {
      topic: asSearchPhrase(channel.name),
      channelName: channel.name,
      subchannelName: null,
      profile,
      homeLocation,
      trustedSourceDomains,
    };
    const keptMain = filterByRelevance(remaining, mainCtx);
    if (keptMain.length > 0) placements.push({ channelId: channel.id, subchannelId: null, articles: keptMain });
  }

  return placements;
}
