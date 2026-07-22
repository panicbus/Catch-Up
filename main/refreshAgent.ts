import type { DataStore } from './dataStore';
import type { ArticlesCache } from './articlesCache';
import { runProviders, getProviderStatus } from './providers/registry';
import type { DataChangeEvent } from '../ipc-contract';

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
 * slot across runs (rather than reshuffling every cycle) — same hash shape as the renderer's
 * channelColor.ts. */
function hashToInt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
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
    const channels = deps.dataStore.getChannels();
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

  // The plain channel-name search always runs, even when subchannels exist — subchannels narrow
  // in addition to the channel's own general coverage, not instead of it. Overlap between this and
  // a subchannel-specific search is handled by articlesCache.merge()'s existing URL/title dedup.
  const subchannels =
    options?.staggerCycle === undefined
      ? channel.subchannels
      : channel.subchannels.filter(
          (sc) => hashToInt(sc.id) % STAGGER_FACTOR === (options.staggerCycle as number) % STAGGER_FACTOR
        );
  const targets: { topic: string; subchannelId: string | null }[] = [
    { topic: channel.name, subchannelId: null },
    ...subchannels.map((sc) => ({ topic: `${channel.name} ${sc.name}`, subchannelId: sc.id })),
  ];

  let added = 0;
  const errors: string[] = [];
  for (const target of targets) {
    try {
      const fetched = await runProviders({ topic: target.topic, channelId, subchannelId: target.subchannelId });
      added += deps.articlesCache.merge(channelId, target.subchannelId, 'mixed', fetched);
    } catch (e) {
      errors.push(String(e));
    }
    await sleep(PROVIDER_PACING_MS);
  }

  if (added > 0) deps.broadcast({ type: 'articles', channelId });

  const rateLimitedProviders = getProviderStatus()
    .filter((p) => p.configured && p.rateLimited)
    .map((p) => p.label);

  return { channelId, added, providersRun: [], errors, rateLimitedProviders };
}
