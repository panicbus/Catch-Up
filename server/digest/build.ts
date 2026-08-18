/** Assembles one user's digest content: their selected channels' top unread stories (by the
 * relevance ranking built in Phases 1-3), plus an optional AI-written recap on top. Pure content
 * assembly — server/digest/render.ts turns this into an email, server/cron/digest.ts decides
 * whether/when to call any of it. */

import * as dataStore from '../stores/dataStore';
import * as articlesCache from '../stores/articlesCache';
import { summarizeStories, isAiConfigured } from '../../main/providers/classifier';
import type { ProviderConfig } from '../../main/providers/classifier';
import type { Article } from '../../ipc-contract';

const STORIES_PER_CHANNEL = 5;
// Over-fetched relevance-ranked, then filtered down to unread — a channel with several already-read
// stories among its top 5 by score would otherwise come up short. 30 comfortably covers that for any
// realistically-sized channel without pulling a channel's entire pool (capped at 300 rows anyway).
const FETCH_LIMIT = 30;
// The recap only needs the standout few per channel, not the full 5 the list itself carries — keeps
// the summarization prompt bounded regardless of how many channels/stories are configured.
const STORIES_PER_CHANNEL_FOR_SUMMARY = 3;

export interface DigestChannel {
  channelId: string;
  channelName: string;
  channelSlug: string;
  stories: Article[];
}

export interface DigestContent {
  channels: DigestChannel[];
  /** null when AI isn't configured, or the model call failed — the email still sends with just
   * the curated list on days that happens; see classifier.ts's summarizeStories for why this is
   * never a reason to skip sending entirely. */
  summary: string | null;
}

/** Returns null when there's nothing worth sending — every selected channel is either gone
 * (deleted since the digest was configured) or has no unread stories today. */
export async function buildDigestContent(
  userId: string,
  channelIds: string[],
  aiConfig: ProviderConfig | null
): Promise<DigestContent | null> {
  const allChannels = await dataStore.getChannels(userId);
  const bySelectedId = new Map(allChannels.map((c) => [c.id, c]));

  const channels: DigestChannel[] = [];
  for (const channelId of channelIds) {
    const channel = bySelectedId.get(channelId);
    if (!channel) continue;
    const fetched = await articlesCache.getArticles(userId, channelId, null, FETCH_LIMIT, 'relevance');
    const stories = fetched.filter((a) => !a.read).slice(0, STORIES_PER_CHANNEL);
    if (stories.length === 0) continue;
    channels.push({ channelId, channelName: channel.name, channelSlug: channel.slug, stories });
  }

  if (channels.length === 0) return null;

  let summary: string | null = null;
  if (aiConfig && isAiConfigured(aiConfig)) {
    summary = await summarizeStories({
      channels: channels.map((c) => ({
        channelName: c.channelName,
        stories: c.stories.slice(0, STORIES_PER_CHANNEL_FOR_SUMMARY).map((a) => ({ title: a.title, snippet: a.snippet })),
      })),
      config: aiConfig,
    });
  }

  return { channels, summary };
}
