/** Pure, Electron-agnostic AI relevance classifier — same portability contract as the rest of this
 * folder (see types.ts): only `fetch` + process.env, so it lifts straight into a hosted backend.
 *
 * It answers one cheap question per batch — "which of these stories are NOT actually about this
 * channel's topic?" — so we can drop the tangential/wrong-sense results the keyword heuristic can't
 * catch ("Virginia Tech" in a Tech channel; a story that IS about the topic but never names it, like
 * most Pop Culture headlines, is kept). Deliberately conservative: the model only lists the clearly
 * off-topic ids, so anything it omits or is unsure about is kept — recall over precision.
 *
 * PROVIDER-AGNOSTIC BY DESIGN. Ships on Google Gemini's free tier (great for a free app tier); the
 * request shape is the only Gemini-specific part. To move to the paid tier (Claude Haiku) or a local
 * model, swap `callModel()` — nothing else changes. Model/keys come from env:
 *   GEMINI_API_KEY   (required to enable AI filtering; absent ⇒ isAiConfigured() is false ⇒ heuristic)
 *   GEMINI_MODEL     (optional; defaults to a current free-tier Flash model)
 *
 * COST/QUOTA CONTROL lives one layer up (classificationStore.ts): every verdict is cached by article
 * id so a story is classified at most once, and a daily cap bounds spend/quota. See aiRelevance.ts
 * for how the heuristic pre-filter, this call, and the cache are combined. */

import type { ChannelProfile } from './channelProfiles';

// `gemini-flash-latest` is Google's alias for the current free-tier Flash model — it keeps working
// as older pinned versions (gemini-2.0-flash, etc.) roll off the free tier. Override with GEMINI_MODEL
// to pin a specific version if you ever need reproducibility.
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest';
const GEMINI_ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

// Max articles per model call. aiRelevance chunks its work into MAX_BATCH-sized calls; the truncation
// in classifyOffTopic below is only a last-resort guard so a prompt can never grow unbounded.
export const MAX_BATCH = 30;
const REQUEST_TIMEOUT_MS = 15_000;

export interface ClassifyItem {
  id: string;
  title: string;
  snippet: string | null;
}

export interface ClassifyInput {
  items: ClassifyItem[];
  channelName: string;
  /** null for a channel-level search. */
  subchannelName: string | null;
  /** The channel's profile (channelProfiles.ts) — its category + on-topic/anti-topic keywords, handed
   * to the model as the channel's definition so its judgement matches the heuristic's. Optional so the
   * classifier still works standalone (e.g. tests) without one. */
  profile?: ChannelProfile;
}

export function isAiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

/** Validate a candidate key with one tiny request, so the in-app key modal can give real feedback
 * instead of silently falling back. Returns a friendly, status-specific error on failure. */
export async function pingModel(key: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: 'Please paste your Gemini API key.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL, trimmed), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with JSON {"ok":true}' }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 400 || res.status === 403) {
      return { ok: false, error: 'That key was rejected. Double-check you copied the whole key.' };
    }
    if (res.status === 429) {
      return {
        ok: false,
        error:
          'That key is over its quota or its free tier isn’t enabled for this model. Check your quota in Google AI Studio, then try again.',
      };
    }
    return { ok: false, error: `Gemini returned an error (HTTP ${res.status}). Try again in a moment.` };
  } catch {
    return { ok: false, error: 'Couldn’t reach Gemini. Check your internet connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(input: ClassifyInput): { system: string; user: string } {
  const topic = input.subchannelName
    ? `${input.channelName} — specifically "${input.subchannelName}"`
    : input.channelName;
  const system =
    'You are a news relevance filter for a personal news reader. You are given a TOPIC and a list of ' +
    'articles (id, title, snippet). Identify only the articles that are NOT genuinely about the topic ' +
    '— unrelated, or a different sense of an ambiguous word (e.g. "Virginia Tech" sports for a ' +
    '"Tech"/technology topic). IMPORTANT: an article can be on-topic even if its title never contains ' +
    'the topic words (e.g. a celebrity story for a "Pop Culture" topic) — judge the meaning, not ' +
    'keyword overlap. When unsure, KEEP it (do not list it). Respond with JSON only: ' +
    '{"remove": [<ids of the clearly off-topic articles>]}.';

  // Hand the model the channel's profile as its definition — the broad news category it belongs to,
  // and example on-topic / off-topic keywords — so its call lines up with the heuristic's.
  const profile = input.profile;
  const guidance: string[] = [];
  if (profile?.category) guidance.push(`This is a ${profile.category} channel.`);
  if (profile?.include.length) guidance.push(`On-topic stories often involve: ${profile.include.slice(0, 20).join(', ')}.`);
  if (profile?.exclude.length) guidance.push(`Off-topic for this channel: ${profile.exclude.join(', ')}.`);

  const user =
    `TOPIC: ${topic}\n` +
    (guidance.length ? `${guidance.join(' ')}\n` : '') +
    `\nARTICLES:\n` +
    JSON.stringify(
      input.items.map((i) => ({ id: i.id, title: i.title, snippet: i.snippet ?? '' })),
    );
  return { system, user };
}

/** The only provider-specific code. Returns the raw JSON text the model produced, or null on any
 * failure (no key, network error, non-200 incl. 429 rate-limit, timeout). Never throws. */
async function callModel(system: string, user: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL, key), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    if (!res.ok) return null; // 429/5xx/etc. → caller falls back to the heuristic
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null; // network/abort/timeout
  } finally {
    clearTimeout(timer);
  }
}

/** Classify one batch. Returns the set of ids the model judged clearly OFF-topic (to drop), or null
 * if the model was unavailable/failed — in which case the caller keeps the batch (heuristic result)
 * and leaves it unclassified to retry next cycle. Only ids from the input are honored, so a
 * hallucinated id can never affect anything. */
export async function classifyOffTopic(input: ClassifyInput): Promise<Set<string> | null> {
  if (input.items.length === 0) return new Set();
  if (input.items.length > MAX_BATCH) input = { ...input, items: input.items.slice(0, MAX_BATCH) };
  const { system, user } = buildPrompt(input);
  const raw = await callModel(system, user);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as { remove?: unknown };
    const validIds = new Set(input.items.map((i) => i.id));
    const remove = Array.isArray(parsed.remove) ? parsed.remove : [];
    return new Set(remove.filter((id): id is string => typeof id === 'string' && validIds.has(id)));
  } catch {
    return null; // malformed JSON → treat as unavailable, keep the batch
  }
}
