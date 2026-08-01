import { articleId } from './providers/dedupe';
import { filterByRelevance } from './providers/relevance';
import { classifyOffTopic, isAiConfigured, MAX_BATCH } from './providers/classifier';
import type { ClassificationStoreLike } from './classificationStore';
import type { ChannelProfile } from './providers/channelProfiles';
import type { FetchedArticle } from './providers/types';

/** The relevance stage of a refresh, combining the free heuristic and the AI classifier. Sits in
 * main/ (not the pure providers/ folder) because it orchestrates the fs-backed classification store.
 *
 * Pipeline for one freshly-fetched batch:
 *   1. HEURISTIC (always, free): filterByRelevance() applies the soft additive relevance gate (the
 *      channel profile + section signals). Cheap, and it shrinks what the AI ever sees.
 *   2. AI (when configured + under the daily cap): reuse any cached verdict; classify only the
 *      not-yet-seen survivors, in chunks no larger than the model batch size; drop the ones judged
 *      clearly off-topic. Cache every fresh verdict so each story is classified at most once.
 * Every AI failure path (no key, error, rate-limit, cap reached, malformed reply) simply keeps the
 * heuristic result — the refresh can never break or block on the model. */
export async function filterRelevant(
  fetched: FetchedArticle[],
  topic: string,
  channelId: string,
  channelName: string,
  subchannelName: string | null,
  profile: ChannelProfile,
  store: ClassificationStoreLike,
  aiEnabled: boolean,
  homeLocation: { lat: number; lon: number } | null,
): Promise<FetchedArticle[]> {
  // Stage 1 — free heuristic (the soft additive gate, using the channel's profile). Locality is a
  // heuristic-only signal (see relevance.ts) — deliberately not surfaced to the AI classifier below.
  const heuristic = filterByRelevance(fetched, { topic, channelName, subchannelName, profile, homeLocation });
  // Stage 2 requires the user to have turned AI filtering on AND a key to be configured.
  if (!aiEnabled || !isAiConfigured() || heuristic.length === 0) return heuristic;

  // Verdicts are cached per (channel, article), not per article alone: relevance is channel-specific
  // and the same URL legitimately lands in several channels, so a "keep" for one channel must not
  // silently admit the story into another. `id` is what the model sees; `cacheKey` is channel-scoped.
  const entries = heuristic.map((a) => {
    const id = articleId(a.url);
    return { article: a, id, cacheKey: `${channelId}:${id}` };
  });

  const kept: FetchedArticle[] = [];
  const toClassify: typeof entries = [];
  for (const e of entries) {
    const cached = store.getVerdict(e.cacheKey);
    if (cached === true) kept.push(e.article);
    else if (cached === false) continue; // previously judged off-topic for this channel — stays dropped
    else toClassify.push(e); // never seen — needs the model
  }

  // Budget-limit the total for the day, then classify in chunks no larger than MAX_BATCH (so nothing
  // is ever silently truncated). Anything over budget, or in a chunk the model couldn't classify, is
  // kept as-is (heuristic result) and left unclassified to retry on a future cycle.
  const budget = store.remainingDailyBudget();
  const classifiable = budget > 0 ? toClassify.slice(0, budget) : [];
  for (const e of toClassify.slice(classifiable.length)) kept.push(e.article); // over cap → keep

  for (let i = 0; i < classifiable.length; i += MAX_BATCH) {
    const chunk = classifiable.slice(i, i + MAX_BATCH);
    const offTopic = await classifyOffTopic({
      items: chunk.map((e) => ({ id: e.id, title: e.article.title, snippet: e.article.snippet })),
      channelName,
      subchannelName,
      profile,
    });
    if (offTopic == null) {
      // Model unavailable/failed for this chunk — keep it, do NOT cache (so it retries next cycle).
      for (const e of chunk) kept.push(e.article);
    } else {
      store.recordClassifications(chunk.map((e) => ({ id: e.cacheKey, keep: !offTopic.has(e.id) })));
      for (const e of chunk) if (!offTopic.has(e.id)) kept.push(e.article);
    }
  }

  return orderLike(heuristic, kept);
}

/** Return the kept articles in their original fetched order (the feed sorts newest-first later, but
 * keeping input order here avoids surprising downstream dedupe/merge). */
function orderLike(original: FetchedArticle[], kept: FetchedArticle[]): FetchedArticle[] {
  const keepSet = new Set(kept.map((a) => a.url));
  return original.filter((a) => keepSet.has(a.url));
}
