import { articleId } from './providers/dedupe';
import { filterByRelevance } from './providers/relevance';
import { classifyOffTopic, isAiConfigured } from './providers/classifier';
import type { ClassificationStore } from './classificationStore';
import type { FetchedArticle } from './providers/types';

/** The relevance stage of a refresh, combining the free heuristic and the AI classifier. Sits in
 * main/ (not the pure providers/ folder) because it orchestrates the fs-backed classification store.
 *
 * Pipeline for one freshly-fetched batch:
 *   1. HEURISTIC (always, free): filterByRelevance() drops loose Google-News-RSS junk. Cheap, and it
 *      shrinks what the AI ever sees.
 *   2. AI (when configured + under the daily cap): reuse any cached verdict; classify only the
 *      not-yet-seen survivors; drop the ones the model judged clearly off-topic. Cache every fresh
 *      verdict so each story is classified at most once.
 * Every AI failure path (no key, error, rate-limit, cap reached, malformed reply) simply keeps the
 * heuristic result — the refresh can never break or block on the model. */
export async function filterRelevant(
  fetched: FetchedArticle[],
  topic: string,
  channelName: string,
  subchannelName: string | null,
  store: ClassificationStore,
): Promise<FetchedArticle[]> {
  // Stage 1 — free heuristic.
  const heuristic = filterByRelevance(fetched, topic);
  if (!isAiConfigured() || heuristic.length === 0) return heuristic;

  // Stage 2 — AI. Apply cached verdicts; collect the ones still needing a fresh classification.
  const withId = heuristic.map((a) => ({ article: a, id: articleId(a.url) }));
  const kept: FetchedArticle[] = [];
  const toClassify: { article: FetchedArticle; id: string }[] = [];

  for (const entry of withId) {
    const cached = store.getVerdict(entry.id);
    if (cached === true) kept.push(entry.article);
    else if (cached === false) continue; // previously judged off-topic — stays dropped
    else toClassify.push(entry); // never seen — needs the model
  }

  if (toClassify.length === 0) return orderLike(heuristic, kept);

  // Respect the daily cap: classify up to the remaining budget; anything beyond it is kept as-is
  // (heuristic result) and left unclassified to retry on a future cycle once budget frees up.
  const budget = store.remainingDailyBudget();
  const batch = budget > 0 ? toClassify.slice(0, budget) : [];
  const overflow = toClassify.slice(batch.length);
  for (const e of overflow) kept.push(e.article); // over cap → trust the heuristic, don't drop

  if (batch.length > 0) {
    const offTopic = await classifyOffTopic({
      items: batch.map((e) => ({ id: e.id, title: e.article.title, snippet: e.article.snippet })),
      channelName,
      subchannelName,
    });
    if (offTopic == null) {
      // Model unavailable/failed — keep the batch, do NOT cache (so it retries next cycle).
      for (const e of batch) kept.push(e.article);
    } else {
      const verdicts = batch.map((e) => ({ id: e.id, keep: !offTopic.has(e.id) }));
      store.recordClassifications(verdicts);
      for (const e of batch) if (!offTopic.has(e.id)) kept.push(e.article);
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
