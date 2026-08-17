import { articleId } from './providers/dedupe';
import { filterByRelevance, borderlineArticles } from './providers/relevance';
import { classifyOffTopic, isAiConfigured, MAX_BATCH } from './providers/classifier';
import type { ProviderConfig } from './providers/classifier';
import type { ClassificationStoreLike } from './classificationStore';
import type { ChannelProfile } from './providers/channelProfiles';
import type { FetchedArticle } from './providers/types';

/** The relevance stage of a refresh, combining the free heuristic and the AI classifier. Sits in
 * main/ (not the pure providers/ folder) because it orchestrates the fs-backed classification store.
 *
 * Pipeline for one freshly-fetched batch:
 *   1. HEURISTIC (always, free): filterByRelevance() applies the soft additive relevance gate (the
 *      channel profile + section signals). Cheap, and it shrinks what the AI ever sees.
 *   2. BORDERLINE RESCUE (only when AI is configured): borderlineArticles() picks out stories the
 *      heuristic rejected on a precision-only technicality — a multi-word entity missing one of its
 *      words, or a loose source with just one topical keyword hit (see relevance.ts's judgeArticle
 *      for exactly which cases qualify). These get a real semantic second look from the model, NOT
 *      just the strict keyword rules — the whole point being that tightening those rules for
 *      precision (fewer wrong-channel stories) shouldn't have to cost real matches for users who
 *      have AI available to double-check the judgment call. A user with no AI configured never
 *      computes this at all, and simply gets the strict heuristic result, unchanged.
 *   3. AI classification (when configured + under the daily cap): reuse any cached verdict; classify
 *      only the not-yet-seen survivors (both groups combined), in chunks no larger than the model
 *      batch size; drop the ones judged clearly off-topic. Cache every fresh verdict so each story
 *      is classified at most once. Crucially, the two groups fall back DIFFERENTLY when the model
 *      can't be reached or the budget runs out: a heuristic-kept story stays kept (the model
 *      couldn't take anything away from it), but a borderline story stays rejected (the model never
 *      got to give it anything — an unclassified borderline story never had a "keep" verdict of its
 *      own to fall back on).
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
  config: ProviderConfig | null,
  homeLocation: { lat: number; lon: number } | null,
): Promise<FetchedArticle[]> {
  // Locality is a heuristic-only signal (see relevance.ts) — deliberately not surfaced to the AI
  // classifier below, same as before this rescue pass existed.
  const ctx = { topic, channelName, subchannelName, profile, homeLocation };
  const heuristic = filterByRelevance(fetched, ctx);
  // Stage 2/3 require a provider to be picked AND configured (key/model present).
  if (!config || !isAiConfigured(config)) return heuristic;

  const borderline = borderlineArticles(fetched, ctx);
  if (heuristic.length === 0 && borderline.length === 0) return heuristic;

  // Verdicts are cached per (channel, article), not per article alone: relevance is channel-specific
  // and the same URL legitimately lands in several channels, so a "keep" for one channel must not
  // silently admit the story into another. `id` is what the model sees; `cacheKey` is channel-scoped.
  // `fallback` is what happens to this entry if it never actually gets a model opinion this cycle
  // (over budget, or the call fails) — see the file comment above for why the two groups differ.
  const entries = [
    ...heuristic.map((a) => ({ article: a, id: articleId(a.url), cacheKey: `${channelId}:${articleId(a.url)}`, fallback: 'keep' as const })),
    ...borderline.map((a) => ({ article: a, id: articleId(a.url), cacheKey: `${channelId}:${articleId(a.url)}`, fallback: 'reject' as const })),
  ];

  // One batched lookup, then a synchronous partition. Deliberately not a per-article await in a
  // loop: on the hosted (database-backed) store that shape cost one network round-trip per story.
  const cachedVerdicts = await store.getVerdicts(entries.map((e) => e.cacheKey));

  const kept: FetchedArticle[] = [];
  const toClassify: typeof entries = [];
  for (const e of entries) {
    const cached = cachedVerdicts.get(e.cacheKey);
    if (cached === true) kept.push(e.article);
    else if (cached === false) continue; // previously judged off-topic for this channel — stays dropped
    else toClassify.push(e); // never seen — needs the model
  }

  // Budget-limit the total for the day, then classify in chunks no larger than MAX_BATCH (so nothing
  // is ever silently truncated). The daily cap protects real external quotas (Gemini/Groq) — Ollama
  // is the founder's own hardware, nothing to protect against, so it's exempt.
  const budget = config.provider === 'ollama' ? Infinity : await store.remainingDailyBudget();
  const classifiable = budget > 0 ? toClassify.slice(0, budget) : [];
  // Over cap → each entry's own fallback decides its fate (see `entries` above), not a blanket keep.
  for (const e of toClassify.slice(classifiable.length)) {
    if (e.fallback === 'keep') kept.push(e.article);
  }

  for (let i = 0; i < classifiable.length; i += MAX_BATCH) {
    const chunk = classifiable.slice(i, i + MAX_BATCH);
    const offTopic = await classifyOffTopic({
      items: chunk.map((e) => ({ id: e.id, title: e.article.title, snippet: e.article.snippet })),
      channelName,
      subchannelName,
      profile,
      config,
    });
    if (offTopic == null) {
      // Model unavailable/failed for this chunk — do NOT cache (so it retries next cycle); each
      // entry's own fallback decides its fate for THIS cycle, same as the over-budget case above.
      for (const e of chunk) if (e.fallback === 'keep') kept.push(e.article);
    } else {
      await store.recordClassifications(chunk.map((e) => ({ id: e.cacheKey, keep: !offTopic.has(e.id) })));
      for (const e of chunk) if (!offTopic.has(e.id)) kept.push(e.article);
    }
  }

  return orderLike(fetched, kept);
}

/** Return the kept articles in their original fetched order (the feed sorts newest-first later, but
 * keeping input order here avoids surprising downstream dedupe/merge). */
function orderLike(original: FetchedArticle[], kept: FetchedArticle[]): FetchedArticle[] {
  const keepSet = new Set(kept.map((a) => a.url));
  return original.filter((a) => keepSet.has(a.url));
}
