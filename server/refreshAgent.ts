/** Database-backed replacement for main/refreshAgent.ts's runChannel/runAll — same orchestration
 * (staggered subchannels, per-target provider fetch + relevance filtering + merge), same pacing.
 * The differences are exactly the ones the deployment plan called out: no tray/keep-alive hack
 * (there's no window to keep alive on a server — the scheduled job just runs and exits), the
 * classification store is now a real per-user instance instead of a shared file, and there's no
 * broadcast — the website finds out about new articles by polling, not a push (see the plan's
 * "Live-updates" section for why that's the right tradeoff here). */

import { runProviders, getProviderStatus } from '../main/providers/registry';
import { filterRelevant } from '../main/aiRelevance';
import { channelProfile } from '../main/providers/channelProfiles';
import * as dataStore from './stores/dataStore';
import * as articlesCache from './stores/articlesCache';
import { ServerClassificationStore } from './stores/classificationStore';

const PROVIDER_PACING_MS = 300;
const STAGGER_FACTOR = 3;

export interface RunResult {
  channelId: string | null;
  added: number;
  // Always empty — matches the original desktop version's RunResult, which never actually
  // populates this field either. Kept only so the response shape matches RefreshResult
  // (ipc-contract.ts) for the frontend, which expects the field to exist.
  providersRun: string[];
  errors: string[];
  rateLimitedProviders: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same hash as main/refreshAgent.ts's copy (and the renderer's src/utils/hash.ts) — kept as its
// own copy for the same reason: separate compile targets, and it's only a few lines.
function hashToInt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

function asSearchPhrase(name: string): string {
  const trimmed = name.trim();
  return trimmed.includes(' ') ? `"${trimmed}"` : trimmed;
}

export async function runAll(userId: string): Promise<RunResult[]> {
  const channels = await dataStore.getChannels(userId);
  const active = channels.filter((c) => !c.pausedUntil || new Date(c.pausedUntil).getTime() <= Date.now());
  const results: RunResult[] = [];
  // A single stagger cycle per run — this is triggered on a schedule (see server's cron
  // entrypoint), each invocation is its own independent "cycle", unlike the desktop app's
  // long-running in-memory counter.
  const cycle = Math.floor(Date.now() / (30 * 60 * 1000));
  for (const channel of active) {
    results.push(await runChannel(userId, channel.id, { staggerCycle: cycle }));
  }
  return results;
}

export async function runChannel(
  userId: string,
  channelId: string,
  options?: { staggerCycle?: number }
): Promise<RunResult> {
  const channels = await dataStore.getChannels(userId);
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) {
    return { channelId, added: 0, providersRun: [], errors: [`Channel not found: ${channelId}`], rateLimitedProviders: [] };
  }

  const profile = channelProfile(channel.name);
  const [settings, aiEnabled, geminiKey] = await Promise.all([
    dataStore.getSettings(userId),
    dataStore.getAiEnabled(userId),
    dataStore.getGeminiApiKey(userId),
  ]);
  const homeLocation = settings.homeLocation;
  const classificationStore = new ServerClassificationStore(userId);

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
      const relevant = await filterRelevant(
        fetched,
        target.topic,
        channelId,
        channel.name,
        target.subchannelName,
        profile,
        classificationStore,
        aiEnabled,
        homeLocation,
        geminiKey ?? undefined
      );
      added += await articlesCache.merge(userId, channelId, target.subchannelId, relevant);
    } catch (e) {
      errors.push(String(e));
    }
    // Between targets only, never after the last — see the matching comment in main/refreshAgent.ts.
    if (i < targets.length - 1) await sleep(PROVIDER_PACING_MS);
  }

  const rateLimitedProviders = getProviderStatus()
    .filter((p) => p.configured && p.rateLimited)
    .map((p) => p.label);

  return { channelId, added, providersRun: [], errors, rateLimitedProviders };
}
