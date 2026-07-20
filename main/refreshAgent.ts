import type { DataStore } from './dataStore';
import type { ArticlesCache } from './articlesCache';
import { runProviders, getProviderStatus } from './providers/registry';
import type { DataChangeEvent } from '../ipc-contract';

const INTERVAL_MS = 30 * 60 * 1000;
const PROVIDER_PACING_MS = 300;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    for (const channel of channels) {
      results.push(await runChannel(deps, channel.id));
    }
    return results;
  } finally {
    isRunning = false;
  }
}

export async function runChannel(deps: RefreshDeps, channelId: string): Promise<RunResult> {
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
  const targets: { topic: string; subchannelId: string | null }[] = [
    { topic: channel.name, subchannelId: null },
    ...channel.subchannels.map((sc) => ({ topic: `${channel.name} ${sc.name}`, subchannelId: sc.id })),
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
