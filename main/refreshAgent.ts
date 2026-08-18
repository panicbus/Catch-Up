import type { DataStore } from './dataStore';
import type { ArticlesCache } from './articlesCache';
import type { ClassificationStore } from './classificationStore';
import { runProviders, getProviderStatus } from './providers/registry';
import { filterRelevant } from './aiRelevance';
import { channelProfile } from './providers/channelProfiles';
import type { ProviderConfig } from './providers/classifier';
import type { DataChangeEvent } from '../ipc-contract';

/** Build the classifier config from the persisted setting, or null (AI off) if none is picked or
 * the picked provider's credential/setting isn't actually filled in. */
function buildAiConfig(dataStore: DataStore): ProviderConfig | null {
  const provider = dataStore.getAiProvider();
  if (provider === 'gemini') return { provider, apiKey: dataStore.getGeminiApiKey() ?? undefined };
  if (provider === 'groq') return { provider, apiKey: dataStore.getGroqApiKey() ?? undefined };
  if (provider === 'ollama') return { provider, ollamaModel: dataStore.getOllamaModel() };
  return null;
}

const INTERVAL_MS = 30 * 60 * 1000;
const PROVIDER_PACING_MS = 300;

/** Every channel-name search still runs on every background cycle; subchannels are split into
 * this many rotating buckets (one bucket refreshed per cycle) so a channel with e.g. 6
 * subchannels doesn't fire 6 extra full provider fan-outs every single cycle — each subchannel
 * still gets refreshed at least once every STAGGER_FACTOR cycles (~90 min at the current 30-min
 * interval) instead of every cycle. Only applies to the automatic background sweep — a manual
 * "Refresh" click, or a newly created channel/subchannel, always fetches everything immediately
 * (see the `staggerCycle` param below, which those call sites simply omit). */
const STAGGER_FACTOR = 3;

export interface RefreshDeps {
  dataStore: DataStore;
  articlesCache: ArticlesCache;
  classificationStore: ClassificationStore;
  broadcast: (event: DataChangeEvent) => void;
}

interface RunResult {
  channelId: string | null;
  added: number;
  providersRun: string[];
  errors: string[];
  rateLimitedProviders: string[];
}

let timer: NodeJS.Timeout | null = null;
let isRunning = false;
let backgroundCycle = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stable per-subchannel bucket assignment, so the same subchannel lands in the same rotation
 * slot across runs (rather than reshuffling every cycle) — same hash as the renderer's
 * src/utils/hash.ts. Kept as its own copy rather than a shared import since main/renderer are
 * separate TypeScript compile targets (tsconfig.electron.json vs tsconfig.json) and this is only
 * a few lines. */
function hashToInt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

/** A multi-word channel/subchannel name searched as loose, unquoted terms lets providers match on
 * any single word in it — e.g. a "Greek Theater" subchannel pulling in unrelated "Greek" results
 * that have nothing to do with the venue. Wrapping it in double quotes signals an exact-phrase
 * match instead, a search-query convention every one of this app's current providers' backends
 * honors. Single-word names are returned as-is — nothing to disambiguate, and quoting a single
 * word buys nothing. */
function asSearchPhrase(name: string): string {
  const trimmed = name.trim();
  return trimmed.includes(' ') ? `"${trimmed}"` : trimmed;
}

export function start(deps: RefreshDeps): void {
  void runAll(deps);
  timer = setInterval(() => void runAll(deps), INTERVAL_MS);
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function runAll(deps: RefreshDeps): Promise<RunResult[]> {
  if (isRunning) return [];
  isRunning = true;
  try {
    // Skip paused channels — the whole point of pausing is no background fetching.
    const channels = deps.dataStore.getChannels().filter((c) => !deps.dataStore.isChannelPaused(c.id));
    const results: RunResult[] = [];
    const cycle = backgroundCycle++;
    for (const channel of channels) {
      results.push(await runChannel(deps, channel.id, { staggerCycle: cycle }));
    }
    return results;
  } finally {
    isRunning = false;
  }
}

export async function runChannel(
  deps: RefreshDeps,
  channelId: string,
  options?: { staggerCycle?: number }
): Promise<RunResult> {
  const channel = deps.dataStore.getChannels().find((c) => c.id === channelId);
  if (!channel) {
    return {
      channelId,
      added: 0,
      providersRun: [],
      errors: [`Channel not found: ${channelId}`],
      rateLimitedProviders: [],
    };
  }

  // Derived once per channel: which broad news category (if any) this channel is, plus its on-topic
  // /anti-topic keyword rules. Drives both the provider query (category-narrowed where supported) and
  // the relevance gate + AI classifier downstream.
  const profile = channelProfile(channel.name);
  const settings = deps.dataStore.getSettings();
  const homeLocation = settings.homeLocation;
  const trustedSourceDomains = settings.trustedSourceDomains;

  // The plain channel-name search always runs, even when subchannels exist — subchannels narrow
  // in addition to the channel's own general coverage, not instead of it. Overlap between this and
  // a subchannel-specific search is handled by articlesCache.merge()'s existing URL/title dedup.
  const subchannels =
    options?.staggerCycle === undefined
      ? channel.subchannels
      : channel.subchannels.filter(
          (sc) => hashToInt(sc.id) % STAGGER_FACTOR === (options.staggerCycle as number) % STAGGER_FACTOR
        );
  const targets: { topic: string; subchannelId: string | null; subchannelName: string | null }[] = [
    { topic: asSearchPhrase(channel.name), subchannelId: null, subchannelName: null },
    ...subchannels.map((sc) => ({
      topic: `${asSearchPhrase(channel.name)} ${asSearchPhrase(sc.name)}`,
      subchannelId: sc.id,
      subchannelName: sc.name,
    })),
  ];

  let added = 0;
  const errors: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    try {
      const fetched = await runProviders({
        topic: target.topic,
        channelId,
        subchannelId: target.subchannelId,
        category: profile.category,
      });
      // Relevance stage: free heuristic first (soft additive gate), then the AI classifier when a
      // key is configured (drops tangential/wrong-sense results the keywords can't catch). Always
      // degrades to the heuristic on any AI failure — see aiRelevance.ts.
      const relevant = await filterRelevant(
        fetched,
        target.topic,
        channelId,
        channel.name,
        target.subchannelName,
        profile,
        deps.classificationStore,
        buildAiConfig(deps.dataStore),
        homeLocation,
        trustedSourceDomains
      );
      added += deps.articlesCache.merge(channelId, target.subchannelId, relevant);
    } catch (e) {
      errors.push(String(e));
    }
    // Spacing goes BETWEEN targets, not after the last one — a trailing pause delays the result the
    // caller is waiting on without smoothing anything, since there's no following request to space
    // away from.
    if (i < targets.length - 1) await sleep(PROVIDER_PACING_MS);
  }

  if (added > 0) deps.broadcast({ type: 'articles', channelId });

  const rateLimitedProviders = getProviderStatus()
    .filter((p) => p.configured && p.rateLimited)
    .map((p) => p.label);

  return { channelId, added, providersRun: [], errors, rateLimitedProviders };
}
