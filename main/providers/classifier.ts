/** Pure, Electron-agnostic AI relevance classifier — same portability contract as the rest of this
 * folder (see types.ts): only `fetch` + process.env, so it lifts straight into a hosted backend.
 *
 * It answers one cheap question per batch — "which of these stories are NOT actually about this
 * channel's topic?" — so we can drop the tangential/wrong-sense results the keyword heuristic can't
 * catch ("Virginia Tech" in a Tech channel; a story that IS about the topic but never names it, like
 * most Pop Culture headlines, is kept). Deliberately conservative: the model only lists the clearly
 * off-topic ids, so anything it omits or is unsure about is kept — recall over precision.
 *
 * PROVIDER-AGNOSTIC BY DESIGN, and genuinely multi-provider today: Gemini (Google's free tier), Groq
 * (a free-tier cloud API serving open-source models — always-on, so it works from both the desktop
 * app and the hosted server) and Ollama (a fully local model — desktop-only, since "localhost" means
 * a different machine on the hosted server). `buildPrompt()` is shared prose, not provider-specific;
 * only each `callXModel()` differs in wire format. Model/keys come from env, one set per provider:
 *   GEMINI_API_KEY / GEMINI_MODEL   (Gemini; absent key ⇒ heuristic)
 *   GROQ_API_KEY / GROQ_MODEL       (Groq; absent key ⇒ heuristic)
 *   OLLAMA_BASE_URL                 (Ollama; defaults to http://localhost:11434)
 *
 * COST/QUOTA CONTROL lives one layer up (classificationStore.ts): every verdict is cached by article
 * id so a story is classified at most once, and a daily cap bounds spend/quota for Gemini/Groq (not
 * Ollama, which runs on the founder's own hardware — see aiRelevance.ts). See aiRelevance.ts for how
 * the heuristic pre-filter, this call, and the cache are combined. */

import type { ChannelProfile } from './channelProfiles';

export type AiProvider = 'gemini' | 'groq' | 'ollama';

/** Whichever credential/setting the active provider needs. Gemini/Groq use `apiKey` (falls back to
 * the matching env var when omitted — the hosted server passes each account's own key explicitly;
 * the desktop app relies on the env-var fallback). Ollama uses `ollamaModel`/`ollamaBaseUrl` instead
 * of a key — it has no quota to protect, just a local server that may or may not be running. */
export interface ProviderConfig {
  provider: AiProvider;
  apiKey?: string;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
}

// Pinned, not `gemini-flash-latest` — confirmed live that alias currently resolves to
// gemini-3.7-flash, a newer model with a free-tier cap of just 20 requests/day, discovered when
// digest-summarization testing exhausted it almost immediately. Also confirmed live: every 2.x
// Flash model (2.5-flash, 2.5-flash-lite, 2.0-flash) now 404s as fully deprecated, not just
// superseded — Google's own error message for each points to gemini-3.6-flash as the current
// replacement, one generation behind "latest"'s 3.7, which is the pin here on the theory that the
// newest release is what gets the tightest free-tier cap during its own rollout. Override with
// GEMINI_MODEL if you want a different one (or to try "latest" again once 3.7 settles down).
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';
const GEMINI_ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export const OLLAMA_DEFAULT_MODEL = 'qwen2.5:7b';
const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';
// A little past this app's own 30-minute background refresh cadence, so consecutive scheduled runs
// tend to find the model already warm instead of paying the ~5s cold-load cost every time.
const OLLAMA_KEEP_ALIVE = '35m';

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
  /** The user's home country (a display name, e.g. "the United States"), when known — used only to
   * add the foreign-politics guidance below on a Politics channel. Catches the one gap the heuristic
   * locality signal in relevance.ts can't: a story that names a foreign political figure ("Modi")
   * with no place word anywhere, so there's nothing for that lookup-based check to find. null/absent
   * means no home location is set, or it doesn't resolve to a country this app can name — the
   * guidance is simply omitted in either case, same as any other optional profile context here. */
  homeCountryName?: string | null;
  config: ProviderConfig;
}

function ollamaBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || process.env.OLLAMA_BASE_URL?.trim() || OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function isAiConfigured(config: ProviderConfig | null | undefined): boolean {
  if (!config) return false;
  if (config.provider === 'gemini') return !!(config.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
  if (config.provider === 'groq') return !!(config.apiKey ?? process.env.GROQ_API_KEY)?.trim();
  return !!config.ollamaModel?.trim();
}

/** Validate a candidate Gemini key with one tiny request, so the in-app key modal can give real
 * feedback instead of silently falling back. Returns a friendly, status-specific error on failure. */
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

/** Validate a candidate Groq key with one tiny request — mirrors pingModel above. */
export async function pingGroq(key: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: 'Please paste your Groq API key.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${trimmed}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: 'Reply with JSON {"ok":true}' }],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'That key was rejected. Double-check you copied the whole key.' };
    }
    if (res.status === 429) {
      return {
        ok: false,
        error: 'That key is over its quota. Check your limits at console.groq.com, then try again.',
      };
    }
    return { ok: false, error: `Groq returned an error (HTTP ${res.status}). Try again in a moment.` };
  } catch {
    return { ok: false, error: 'Couldn’t reach Groq. Check your internet connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Check that Ollama is reachable AND the named model is actually pulled — two distinct, common
 * failure modes that deserve two distinct, friendly errors rather than one generic one. Desktop-only
 * (the web build never offers Ollama, so never calls this), but lives here alongside the others since
 * it's just another `fetch`. */
export async function pingOllama(model: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = model.trim();
  if (!trimmed) return { ok: false, error: 'Enter the name of a model you’ve pulled with Ollama.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ollamaBaseUrl(baseUrl)}/api/tags`, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `Ollama returned an error (HTTP ${res.status}).` };
    const data = (await res.json()) as { models?: { name?: string }[] };
    const names = (data.models ?? []).map((m) => m.name);
    if (names.includes(trimmed)) return { ok: true };
    return {
      ok: false,
      error: `Ollama is running, but "${trimmed}" isn’t pulled yet. Run "ollama pull ${trimmed}" and try again.`,
    };
  } catch {
    return { ok: false, error: 'Couldn’t reach Ollama. Make sure "ollama serve" is running on this Mac.' };
  } finally {
    clearTimeout(timer);
  }
}

export interface SummarizeStory {
  title: string;
  snippet: string | null;
}

export interface SummarizeChannel {
  channelName: string;
  stories: SummarizeStory[];
}

export interface SummarizeInput {
  channels: SummarizeChannel[];
  config: ProviderConfig;
}

function buildSummaryPrompt(input: SummarizeInput): { system: string; user: string } {
  const system =
    'You write a short daily recap email for a personal news reader. You are given several channel ' +
    'names, each with its top stories (title, snippet). Write a plain, conversational recap of the ' +
    'most noteworthy things across ALL of it — 3 to 5 sentences total, not a list, not per-channel ' +
    'headers, no markdown. Sound like a person catching a friend up, not a press release. Skip ' +
    'routine or minor stories; focus on what actually matters. Respond with JSON only: ' +
    '{"summary": "<the recap text>"}.';

  const user = JSON.stringify(
    input.channels.map((c) => ({
      channel: c.channelName,
      stories: c.stories.map((s) => ({ title: s.title, snippet: s.snippet ?? '' })),
    }))
  );
  return { system, user };
}

/** Writes the digest email's short recap paragraph — see server/digest/build.ts, the only caller.
 * Returns null on any failure (no key/model, network error, malformed reply), same never-throws
 * contract as classifyOffTopic; the caller sends the curated list without a recap that day rather
 * than not sending at all. */
export async function summarizeStories(input: SummarizeInput): Promise<string | null> {
  if (input.channels.every((c) => c.stories.length === 0)) return null;
  const { system, user } = buildSummaryPrompt(input);
  const raw = await callModel(system, user, input.config);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as { summary?: unknown };
    return typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null;
  } catch {
    return null;
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
  // Politics-specific, and only when we know the reader's home country: the heuristic gate in
  // relevance.ts already deprioritizes foreign countries/continents named in a story, but has
  // nothing to work with when a story names only a foreign political figure ("Modi defends reform
  // bill") with no place word at all. The model can catch that semantically instead.
  if (profile?.category === 'politics' && input.homeCountryName) {
    guidance.push(
      `The reader is in ${input.homeCountryName}. Treat routine coverage of another country's own ` +
        `domestic politics — even if it never names that country, e.g. only naming a foreign ` +
        `political figure — as off-topic, unless it's a major story with clear global significance ` +
        `or a direct connection to ${input.homeCountryName}.`
    );
  }

  const user =
    `TOPIC: ${topic}\n` +
    (guidance.length ? `${guidance.join(' ')}\n` : '') +
    `\nARTICLES:\n` +
    JSON.stringify(
      input.items.map((i) => ({ id: i.id, title: i.title, snippet: i.snippet ?? '' })),
    );
  return { system, user };
}

async function callGeminiModel(system: string, user: string, apiKey?: string): Promise<string | null> {
  const key = (apiKey ?? process.env.GEMINI_API_KEY)?.trim();
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

async function callGroqModel(system: string, user: string, apiKey?: string): Promise<string | null> {
  const key = (apiKey ?? process.env.GROQ_API_KEY)?.trim();
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callOllamaModel(system: string, user: string, model?: string, baseUrl?: string): Promise<string | null> {
  const resolvedModel = model?.trim() || OLLAMA_DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ollamaBaseUrl(baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        format: 'json',
        stream: false, // /api/chat streams newline-delimited JSON by default; we want one full response
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: { temperature: 0 },
      }),
    });
    if (!res.ok) return null; // server not running, model not pulled, etc.
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? null;
  } catch {
    return null; // network/abort/timeout
  } finally {
    clearTimeout(timer);
  }
}

/** The only provider-specific code. Returns the raw JSON text the model produced, or null on any
 * failure (no key/model, network error, non-200 incl. 429 rate-limit, timeout). Never throws. */
async function callModel(system: string, user: string, config: ProviderConfig): Promise<string | null> {
  if (config.provider === 'gemini') return callGeminiModel(system, user, config.apiKey);
  if (config.provider === 'groq') return callGroqModel(system, user, config.apiKey);
  return callOllamaModel(system, user, config.ollamaModel, config.ollamaBaseUrl);
}

/** Classify one batch. Returns the set of ids the model judged clearly OFF-topic (to drop), or null
 * if the model was unavailable/failed — in which case the caller keeps the batch (heuristic result)
 * and leaves it unclassified to retry next cycle. Only ids from the input are honored, so a
 * hallucinated id can never affect anything. */
export async function classifyOffTopic(input: ClassifyInput): Promise<Set<string> | null> {
  if (input.items.length === 0) return new Set();
  if (input.items.length > MAX_BATCH) input = { ...input, items: input.items.slice(0, MAX_BATCH) };
  const { system, user } = buildPrompt(input);
  const raw = await callModel(system, user, input.config);
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
