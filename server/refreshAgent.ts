/** Database-backed replacement for main/refreshAgent.ts's runChannel/runAll — same orchestration
 * (staggered subchannels, per-target provider fetch + relevance filtering + merge), same pacing.
 * The differences are exactly the ones the deployment plan called out: no tray/keep-alive hack
 * (there's no window to keep alive on a server — the scheduled job just runs and exits), the
 * classification store is now a real per-user instance instead of a shared file, and there's no
 * broadcast — the website finds out about new articles by polling, not a push (see the plan's
 * "Live-updates" section for why that's the right tradeoff here). */

import { runProviders, getProviderStatus } from '../main/providers/registry';
import type { ProviderGate } from '../main/providers/registry';
import { filterRelevant } from '../main/aiRelevance';
import { channelProfile } from '../main/providers/channelProfiles';
import { providerCountryCode } from '../main/providers/relevance';
import { routeByCountry } from '../main/locality/politicsGeoRouting';
import type { ProviderConfig, AiProvider } from '../main/providers/classifier';
import * as dataStore from './stores/dataStore';
import * as articlesCache from './stores/articlesCache';
import { ServerClassificationStore } from './stores/classificationStore';
import { assertSearchBudget, recordSearches, RateLimitedError } from './stores/providerBudget';
import { runCustomSources } from './customSources/refresh';

/** Build the classifier config from the persisted setting, or null (AI off) if none is picked.
 * Ollama can be persisted here in principle (same Settings row shape as desktop) but is never
 * actually reachable from the server — isAiConfigured() will report it unconfigured since
 * `ollamaModel` is never populated server-side, and filterRelevant falls back to the heuristic.
 * Exported: server/cron/digest.ts needs the identical construction for its own AI summarization
 * call, and this is the one place it was already correctly implemented. */
export function buildAiConfig(
  provider: AiProvider | null,
  geminiKey: string | null,
  groqKey: string | null
): ProviderConfig | null {
  if (provider === 'gemini') return { provider, apiKey: geminiKey ?? undefined };
  if (provider === 'groq') return { provider, apiKey: groqKey ?? undefined };
  if (provider === 'ollama') return { provider };
  return null;
}

const PROVIDER_PACING_MS = 300;
const STAGGER_FACTOR = 3;

/** Same rotating-bucket idea as STAGGER_FACTOR above, one level up: which CHANNELS run this cycle
 * at all, not just which of a running channel's subchannels do. Confirmed live as a real problem,
 * not a hypothetical one — the news-provider API keys are shared across every account on this
 * server (see providerBudget.ts), and refreshing every channel across every account every 30
 * minutes burned a free key's entire daily allowance within the first couple of hours, leaving
 * every account with nothing new for the rest of the day.
 *
 * Relaxed from the original 11 to 4 (each channel now lands roughly 48/4 = 12 refreshes a day, once
 * every ~2 hours) now that buildPacedGate (see providerUsage.ts, wired into runAll below) is the
 * thing actually protecting the shared quota — it caps real provider SPEND directly, so this no
 * longer has to be blunt enough to do that job alone. It still exists for a reason unrelated to
 * quota: it spreads channels' fetches across the day rather than firing all of them in the same
 * cron tick, which is its own kind of fairness (every channel gets a turn) independent of budget.
 *
 * Must share no common factor with STAGGER_FACTOR (3) — both this and the subchannel rotation below
 * key off the SAME cycle number. If the two factors shared a factor, a given channel would always
 * land on the exact same `cycle % STAGGER_FACTOR` remainder every single time it happened to run,
 * permanently starving 2 of its 3 subchannel buckets rather than rotating through all of them. 4 and
 * 3 are coprime, so the pair of remainders still visits every combination over time (one full cycle
 * every 12 runs, ~6 hours). If either constant ever changes, keep them coprime.
 *
 * NOT mirrored in main/refreshAgent.ts (the desktop twin), which stays at 11: desktop has no
 * buildPacedGate equivalent (no shared database, no cross-account quota to pace — the whole reason
 * that store exists), so its own free-tier key is still only protected by this blunt throttle alone,
 * and loosening it there would reopen the exact overshoot both files were originally built to fix. */
const CHANNEL_STAGGER_FACTOR = 4;

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

export async function runAll(userId: string, gate?: ProviderGate): Promise<RunResult[]> {
  const channels = await dataStore.getChannels(userId);
  const active = channels.filter((c) => !c.pausedUntil || new Date(c.pausedUntil).getTime() <= Date.now());
  const results: RunResult[] = [];
  // A single stagger cycle per run — this is triggered on a schedule (see server's cron
  // entrypoint), each invocation is its own independent "cycle", unlike the desktop app's
  // long-running in-memory counter.
  const cycle = Math.floor(Date.now() / (30 * 60 * 1000));
  // Channel-level rotation (see CHANNEL_STAGGER_FACTOR) — only this automatic sweep filters here;
  // a manual "Refresh" click (server/routes.ts) calls runChannel directly and never reaches this
  // loop, so it always fetches immediately regardless of whose turn it is. Applies to every
  // account including the owner's — throttling the owner's own consumption down from "every
  // channel, every 30 minutes" is a real part of what stops one heavy account from burning a
  // shared key's entire daily allowance before anyone else gets a turn.
  const due = active.filter((c) => hashToInt(c.id) % CHANNEL_STAGGER_FACTOR === cycle % CHANNEL_STAGGER_FACTOR);
  for (const channel of due) {
    try {
      // `gate` is built ONCE per cron invocation, by the caller (server/cron/refresh.ts), and
      // handed to every user's runAll call in that same run — never built here. This function is
      // itself called once PER USER inside that job's own loop, so a gate built fresh on every
      // call would let every account spend up to the same "per run" allowance independently,
      // multiplying real spend by however many accounts exist instead of pacing it. Undefined for
      // any other caller (there are none today), same as options?.gate below — ungated, exactly
      // like the desktop app.
      results.push(await runChannel(userId, channel.id, { staggerCycle: cycle, gate }));
    } catch (e) {
      if (!(e instanceof RateLimitedError)) throw e;
      // Out of budget for the day (never true for the owner — see providerBudget.ts). Record it
      // once and stop rather than let every remaining channel throw the same way — there's nothing
      // left to spend regardless of how many channels are left to try.
      results.push({
        channelId: channel.id,
        added: 0,
        providersRun: [],
        errors: [`Daily refresh limit reached. Resets ${e.resetsAt.toISOString()}.`],
        rateLimitedProviders: [],
      });
      break;
    }
  }

  // Once per user per round, not once per channel — see server/customSources/refresh.ts's own file
  // comment for why. Deliberately outside the per-channel try/catch above and never counted against
  // assertSearchBudget/recordSearches: a user's own sources don't touch the shared provider-key
  // quota that budget protects, and a source failing shouldn't be reported as if a CHANNEL failed
  // (each source's own success/failure already lives on its own row, surfaced in Settings instead).
  try {
    await runCustomSources(userId);
  } catch (e) {
    console.error('[refreshAgent] custom sources round failed', e);
  }

  return results;
}

export async function runChannel(
  userId: string,
  channelId: string,
  options?: { staggerCycle?: number; gate?: ProviderGate }
): Promise<RunResult> {
  const channels = await dataStore.getChannels(userId);
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) {
    return { channelId, added: 0, providersRun: [], errors: [`Channel not found: ${channelId}`], rateLimitedProviders: [] };
  }

  // Checked once, up front — a runaway guard on the shared provider quota, not a rationing scheme
  // (see providerBudget.ts). Throws for a capped guest before any provider call is made; always a
  // no-op for the owner. Callers: the interactive refresh route lets this throw straight through to
  // handle()'s 429 mapping; runAll (above) catches it and stops early instead.
  await assertSearchBudget(userId);

  const profile = channelProfile(channel.name);
  // Two reads, not four: getAiProvider/getGeminiApiKey/getGroqApiKey each used to fetch the whole
  // Settings row separately, per channel, on every cron run.
  const [settings, ai] = await Promise.all([
    dataStore.getSettings(userId),
    dataStore.getAiSettings(userId),
  ]);
  const aiConfig = buildAiConfig(ai.provider, ai.geminiApiKey, ai.groqApiKey);
  const homeLocation = settings.homeLocation;
  const trustedSourceDomains = settings.trustedSourceDomains;
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
      // The one place this is derived — the provider query below and the routeByCountry condition
      // further down both read it, so the two can't disagree. See providerCountryCode's own comment
      // for the "US Politics" bug that deriving them separately caused.
      const scopedCountry = providerCountryCode(profile, channel.name, target.subchannelName, homeLocation);
      const fetched = await runProviders(
        {
          topic: target.topic,
          channelId,
          subchannelId: target.subchannelId,
          category: profile.category,
          countryCode: scopedCountry,
        },
        options?.gate
      );
      // channel.subchannels (the full list), not the possibly-staggered `subchannels` above: a
      // subchannel skipped this cycle by staggering still exists and is still a valid exemption for
      // the Politics hard exclude / a valid routing target below — staggering only decides which
      // subchannels get their OWN dedicated fetch this cycle, not which ones exist.
      const relevant = await filterRelevant(
        fetched,
        target.topic,
        channelId,
        channel.name,
        target.subchannelName,
        profile,
        classificationStore,
        aiConfig,
        homeLocation,
        trustedSourceDomains,
        channel.subchannels.map((sc) => sc.name)
      );
      // Politics-only, and only for the main target: a subchannel-specific target already merges
      // under its own real subchannel id, so there's nothing to route for it. See
      // main/locality/politicsGeoRouting.ts for why this can't just be another rule inside
      // filterRelevant's gate. One mergeGroups() call rather than one merge() per group — merge()
      // re-fetches every existing article for the whole channel and re-runs prune() on every call,
      // so calling it once per subchannel here would turn one refresh into that many redundant
      // round-trips to Postgres.
      if (target.subchannelId === null && profile.category === 'politics' && scopedCountry) {
        const routed = routeByCountry(relevant, scopedCountry, channel.subchannels);
        added += await articlesCache.mergeGroups(userId, channelId, [
          { subchannelId: null, articles: routed.main },
          ...[...routed.toSubchannel].map(([subchannelId, articles]) => ({ subchannelId, articles })),
        ]);
      } else {
        added += await articlesCache.merge(userId, channelId, target.subchannelId, relevant);
      }
    } catch (e) {
      errors.push(String(e));
    }
    // Between targets only, never after the last — see the matching comment in main/refreshAgent.ts.
    if (i < targets.length - 1) await sleep(PROVIDER_PACING_MS);
  }
  // One search per target regardless of whether it errored — an error can happen after the provider
  // call already went out (e.g. in filterRelevant or merge), so it still counts. No-op for the owner.
  await recordSearches(userId, targets.length);

  const rateLimitedProviders = getProviderStatus()
    .filter((p) => p.configured && p.rateLimited)
    .map((p) => p.label);

  return { channelId, added, providersRun: [], errors, rateLimitedProviders };
}
