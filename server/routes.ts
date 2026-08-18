/** The hosted equivalent of main/ipcHandlers.ts — same actions, same behavior, reached over real
 * HTTP instead of Electron's in-process bridge. One route per action, mirroring the original
 * one-handler-per-action file closely rather than reorganizing around REST resource conventions,
 * since this is a faithful port of an existing, working action list.
 *
 * Not ported: the push-style `broadcast()` calls the original made after every mutation — there's
 * no open-socket equivalent on a stateless HTTP server; the website finds out about changes by
 * polling instead (see src/services/api.ts). Also not ported: `nativeTheme.themeSource = ...` in
 * setSettings — a native-desktop-window concept with no web equivalent. */

import { Router, type Request, type Response } from 'express';
import { resolveUser, getPublicUser, UnauthorizedError } from './auth';
import { verifyGoogleCredential } from './auth/google';
import { createSession, deleteSession, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from './auth/session';
import { RateLimitedError } from './stores/providerBudget';
import { prisma } from './db';
import { runChannel, runAll } from './refreshAgent';
import { getProviderStatus } from '../main/providers/registry';
import { pingModel, pingGroq } from '../main/providers/classifier';
import { resolveCity } from '../main/locality/gazetteer';
import * as dataStore from './stores/dataStore';
import * as articlesCache from './stores/articlesCache';
import { getReaderContent } from './reader';
import { discoverFeed } from './customSources/discover';
import { mergeCustomArticles, refreshOneCustomSourceNow, CUSTOM_PROVIDER_PREFIX } from './customSources/refresh';
import type { AddCustomSourceResult } from '../ipc-contract';

export const router = Router();

// Runtime cost, not the shared-provider-quota concern MAX_CHANNELS_PER_USER-style caps exist for
// (custom sources never touch that budget — see refreshAgent.ts) — a ceiling on how many feeds one
// account can make the scheduled round fetch and sort every cycle. Applies to every account,
// including the owner, for exactly that reason.
const MAX_CUSTOM_SOURCES_PER_USER = 10;

// Express 5 types a route param as `string | string[]` (to cover repeated/wildcard segments) even
// though none of these routes use those — every param here is genuinely always a single string.
function param(req: Request, name: string): string {
  return req.params[name] as string;
}

// Every route resolves the acting user first — see server/auth.ts. Wrapped so a thrown error
// (e.g. a not-found lookup) becomes a real HTTP error response instead of a bare 500/crash.
function handle(fn: (userId: string, req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const userId = await resolveUser(req);
      const result = await fn(userId, req);
      // undefined (a handler with nothing to report, e.g. `dataStore.markRead`) gets the friendly
      // { ok: true } filler. A real, explicit `null` does NOT — it's the actual, meaningful result
      // for a handler like resolveCity ("no match") or getRandomArticle ("nothing left to roll"),
      // and those two callers' own types (`Promise<{...} | null>`) already expect a literal null
      // back. Collapsing null into `{ ok: true }` here silently turned "not found" into "success":
      // confirmed live as real corruption — resolveHomeLocation's caller checks `if (!resolved)`,
      // but `{ ok: true }` is truthy, so a location that failed to resolve got saved anyway, as
      // `{ ok: true, query }` with no lat/lon/countryCode at all, silently disabling every
      // downstream feature that depends on a real home location.
      res.json(result === undefined ? { ok: true } : result);
    } catch (err) {
      console.error('[routes]', req.method, req.path, err);
      // Distinct status codes, not just message text, so the frontend can react to each without
      // sniffing strings: 401 flips the app to signed-out (see src/services/api.ts's
      // onUnauthorized), 429 carries a resetsAt the frontend formats into "resets in ...".
      if (err instanceof UnauthorizedError) {
        res.status(401).json({ error: err.message });
        return;
      }
      if (err instanceof RateLimitedError) {
        res.status(429).json({ error: err.message, resetsAt: err.resetsAt.toISOString() });
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// --- Auth --------------------------------------------------------------------------------------
//
// The only routes that don't go through handle()'s resolveUser() — /auth/google is how a session
// gets minted in the first place, and /auth/logout destroys one, so neither has (or needs) one yet
// when it starts. /auth/me is the exception: it's an ordinary authenticated read, so it reuses
// handle() exactly like every other route.

router.get('/auth/me', handle((userId) => getPublicUser(userId)));

router.post('/auth/google', async (req: Request, res: Response) => {
  try {
    const { sub, email, name, picture } = await verifyGoogleCredential(req.body?.credential);

    // One transaction: a user that ends up without Settings or Streak 400s on every future route
    // (both are read with findUniqueOrThrow elsewhere), so a partial failure here can't be allowed
    // to leave an account half-created. isOwner is deliberately absent from `update` — signing in
    // must never be able to change who the exempt account is, in either direction.
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.upsert({
        where: { email },
        update: { googleId: sub, authProvider: 'google', avatarUrl: picture, displayName: name ?? undefined },
        create: { email, googleId: sub, authProvider: 'google', avatarUrl: picture, displayName: name },
      });
      await tx.settings.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id } });
      await tx.streak.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id } });
      return u;
    });

    const { token, expiresAt } = await createSession(user.id, req);
    setSessionCookie(res, token, expiresAt);
    res.json({ id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl });
  } catch (err) {
    console.error('[routes] POST /auth/google', err);
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/auth/logout', async (req: Request, res: Response) => {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw === 'string' && raw.length > 0) await deleteSession(raw).catch(() => {});
  clearSessionCookie(res);
  res.json({ ok: true });
});

// --- Onboarding ------------------------------------------------------------------------------

router.get('/onboarding', handle((userId) => dataStore.getOnboardingStatus(userId)));
router.post('/onboarding/complete', handle((userId, req) => dataStore.completeOnboarding(userId, req.body.names ?? [])));

// --- Channels --------------------------------------------------------------------------------

router.get('/channels', handle((userId) => dataStore.getChannels(userId)));

router.post(
  '/channels',
  handle(async (userId, req) => {
    const channel = await dataStore.createChannel(userId, req.body.name);
    // Fire-and-forget first fetch, same as the desktop app — but the .catch() is NOT optional:
    // runChannel's own try/catch only wraps its per-target loop, so a database error in its
    // setup (getChannels/getSettings/...) rejects here. An unhandled rejection terminates the
    // whole Node process by default, i.e. one transient DB blip would take the site down.
    void runChannel(userId, channel.id).catch((err) => console.error('[routes] background refresh failed', err));
    return channel;
  })
);

router.post('/channels/:channelId/rename', handle((userId, req) => dataStore.renameChannel(userId, param(req, 'channelId'), req.body.name)));
router.delete('/channels/:channelId', handle((userId, req) => dataStore.deleteChannel(userId, param(req, 'channelId'))));
router.post('/channels/:channelId/reorder', handle((userId, req) => dataStore.reorderChannel(userId, param(req, 'channelId'), req.body.direction)));
router.post('/channels/order', handle((userId, req) => dataStore.setChannelOrder(userId, req.body.orderedIds)));
router.post('/channels/:channelId/pause', handle((userId, req) => dataStore.setChannelPause(userId, param(req, 'channelId'), req.body.duration)));

router.post(
  '/channels/:channelId/clear',
  handle(async (userId, req) => {
    const channelId = param(req, 'channelId');
    const articles = await articlesCache.getArticles(userId, channelId, null);
    await dataStore.markManyRead(userId, articles.map((a) => a.id));
  })
);

// --- Subchannels -----------------------------------------------------------------------------

router.post(
  '/channels/:channelId/subchannels',
  handle(async (userId, req) => {
    const channelId = param(req, 'channelId');
    const sub = await dataStore.addSubchannel(userId, channelId, req.body.name);
    // Fire-and-forget first fetch for the new subchannel — see the .catch() note in POST /channels.
    void runChannel(userId, channelId).catch((err) => console.error('[routes] background refresh failed', err));
    return sub;
  })
);
router.post(
  '/channels/:channelId/subchannels/:subchannelId/rename',
  handle((userId, req) => dataStore.renameSubchannel(userId, param(req, 'channelId'), param(req, 'subchannelId'), req.body.name))
);
router.delete(
  '/channels/:channelId/subchannels/:subchannelId',
  handle((userId, req) => dataStore.deleteSubchannel(userId, param(req, 'channelId'), param(req, 'subchannelId')))
);

// --- Articles --------------------------------------------------------------------------------

router.get(
  '/articles',
  handle(async (userId, req) => {
    const { channelId, channelIds, subchannelId, limit, sortMode } = req.query as {
      channelId?: string;
      channelIds?: string;
      subchannelId?: string;
      limit?: string;
      sortMode?: string;
    };
    const parsedLimit = limit ? Number(limit) : undefined;
    const parsedSortMode = sortMode === 'relevance' ? 'relevance' : 'newest';
    // `channelIds` (comma-separated) is The Pool's path: it wants a slice of every channel at once,
    // and used to issue one request PER channel to get it. One query with an `IN` replaces all of
    // them. `channelId` stays the single-channel path used by the channel view.
    if (channelIds) {
      const ids = channelIds.split(',').map((s) => s.trim()).filter(Boolean);
      const articles = await articlesCache.getArticlesForChannels(userId, ids, parsedLimit, parsedSortMode);
      return { articles };
    }
    const articles = await articlesCache.getArticles(userId, channelId ?? '', subchannelId ?? null, parsedLimit, parsedSortMode);
    return { articles };
  })
);

// Home tiles only need two integers per channel, not the articles themselves — see
// articlesCache.getChannelCounts for why this endpoint exists at all.
router.get('/channel-counts', handle((userId) => articlesCache.getChannelCounts(userId)));
router.post('/channels/:channelId/refresh', handle((userId, req) => runChannel(userId, param(req, 'channelId'))));
router.post('/refresh-all', handle((userId) => runAll(userId)));
router.get('/provider-status', handle(async () => getProviderStatus()));

// --- Bookmarks -------------------------------------------------------------------------------

router.post(
  '/bookmarks/toggle',
  handle(async (userId, req) => {
    const { articleId, channelId } = req.body as { articleId: string; channelId: string };
    const existing = await articlesCache.getArticleById(userId, channelId, articleId);
    return dataStore.toggleBookmark(
      userId,
      articleId,
      channelId,
      existing
        ? {
            subchannelId: existing.subchannelId,
            url: existing.url,
            title: existing.title,
            snippet: existing.snippet,
            source: existing.source,
            publishedAt: existing.publishedAt.toISOString(),
            paywalled: existing.paywalled,
            imageUrl: existing.imageUrl,
          }
        : undefined
    );
  })
);
router.get('/bookmarks', handle((userId) => dataStore.getBookmarksByChannel(userId)));

// --- Read state --------------------------------------------------------------------------------

router.post('/articles/:articleId/read', handle((userId, req) => dataStore.markRead(userId, param(req, 'articleId'))));
router.post('/articles/:articleId/unread', handle((userId, req) => dataStore.markUnread(userId, param(req, 'articleId'))));

// The reader view (see server/reader/). channelId is a query param, not part of the path, since
// Article's real primary key is (channelId, id) — same requirement as the bookmark toggle route
// above. Deliberately returns 200 with { ok: false, reason } for every "couldn't extract this"
// outcome rather than throwing — see server/reader/index.ts's header comment for why a hard-to-
// scrape site isn't an application error.
router.get(
  '/articles/:articleId/reader',
  handle((userId, req) => getReaderContent(userId, (req.query.channelId as string) ?? '', param(req, 'articleId')))
);

router.get(
  '/random-article',
  handle(async (userId, req) => {
    // Excludes every already-read article, not just the one explicitly passed — same as the
    // original (a fresh "roll" should never surface something already caught up on).
    const exclude = await dataStore.getReadArticleIds(userId);
    const excludeArticleId = req.query.exclude as string | undefined;
    if (excludeArticleId) exclude.add(excludeArticleId);
    const settings = await dataStore.getSettings(userId);
    return articlesCache.getRandomArticle(userId, exclude, settings.rollTheDiceChannelIds);
  })
);

// --- Streak ------------------------------------------------------------------------------------

router.get('/streak', handle((userId) => dataStore.getStreak(userId)));
router.post(
  '/streak/catch-up',
  // `today` is the CLIENT's own local calendar date (see dataStore.recordCatchUp's comment) — the
  // server has no single "the user's timezone" to compute this from itself.
  handle((userId, req) => dataStore.recordCatchUp(userId, req.body.today))
);

// --- Settings ------------------------------------------------------------------------------------

router.get('/settings', handle((userId) => dataStore.getSettings(userId)));
router.post('/settings', handle((userId, req) => dataStore.setSettings(userId, req.body)));
router.post('/settings/resolve-location', handle(async (_userId, req) => resolveCity(req.body.query)));

// --- Custom sources --------------------------------------------------------------------------
// A user's own added news sources — global to the account (see server/customSources/), which is
// why these live next to Settings rather than under /channels the way subchannels do.

router.get('/custom-sources', handle((userId) => dataStore.getCustomSources(userId)));

router.post(
  '/custom-sources',
  handle(async (userId, req): Promise<AddCustomSourceResult> => {
    const url = typeof req.body.url === 'string' ? req.body.url : '';
    // Checked before doing any network work — a request that's going to be rejected regardless
    // shouldn't pay for a discovery round trip first. addCustomSource below re-checks the same cap
    // atomically with the insert, since this early check and that insert are two separate round
    // trips a concurrent second request could slip between.
    const count = await dataStore.countCustomSources(userId);
    if (count >= MAX_CUSTOM_SOURCES_PER_USER) return { ok: false, reason: 'limit-reached' };

    const discovered = await discoverFeed(url);
    if (!discovered.ok) return discovered;

    let created;
    try {
      created = await dataStore.addCustomSource(
        userId,
        {
          feedUrl: discovered.feedUrl,
          siteUrl: url,
          label: discovered.title || new URL(discovered.feedUrl).hostname,
          etag: discovered.validators.etag,
          lastModified: discovered.validators.lastModified,
        },
        MAX_CUSTOM_SOURCES_PER_USER
      );
    } catch (e) {
      if (e instanceof dataStore.CustomSourceLimitError) return { ok: false, reason: 'limit-reached' };
      throw e;
    }
    if (!created) return { ok: false, reason: 'duplicate' };

    // Fire-and-forget, same .catch()-is-not-optional reasoning as POST /channels — but merging the
    // articles discovery already fetched, not re-fetching: discoverFeed's own validation fetch IS
    // this source's first real fetch, so doing it again here would just be a redundant round trip.
    void mergeCustomArticles(
      userId,
      discovered.articles.map((a) => ({ ...a, source: created.label, provider: `${CUSTOM_PROVIDER_PREFIX}${created.id}` }))
    ).catch((err) => console.error('[routes] background custom-source merge failed', err));

    return { ok: true, source: created };
  })
);

router.post(
  '/custom-sources/:id/retry',
  handle(async (userId, req) => {
    const id = param(req, 'id');
    await dataStore.retryCustomSource(userId, id);
    // See retryCustomSource's own doc comment: clearing the disabled state and actually checking
    // the source again are two separate steps on purpose, and a one-tap Retry needs both, not just
    // the first — an immediate on-demand fetch, not a wait for whenever the next scheduled round
    // happens to land. A 404 here (source deleted between the two calls, or never belonged to this
    // user) surfaces as a normal thrown error, same as everywhere else `handle()` wraps.
    const result = await refreshOneCustomSourceNow(userId, id);
    if (result === null) throw new Error('Custom source not found');
  })
);

router.delete('/custom-sources/:id', handle((userId, req) => dataStore.deleteCustomSource(userId, param(req, 'id'))));

// --- AI relevance filtering --------------------------------------------------------------------

router.get(
  '/ai-config',
  handle(async (userId) => {
    // One read of the Settings row rather than four (this used to call four separate getters that
    // each fetched the same full row).
    const ai = await dataStore.getAiSettings(userId);
    // A key from the server's own env (dev/shared) counts as configured too, same as the desktop
    // app's "don't needlessly prompt the modal" behavior. Only ever booleans leave here — the keys
    // themselves are never sent to any client.
    return {
      provider: ai.provider,
      geminiKeyConfigured: !!ai.geminiApiKey || !!process.env.GEMINI_API_KEY?.trim(),
      groqKeyConfigured: !!ai.groqApiKey || !!process.env.GROQ_API_KEY?.trim(),
      // Only the last 4 characters leave the server — see ipc-contract.ts's AiConfig doc. Especially
      // important here: this endpoint currently has no auth, so the full key must never appear in it.
      geminiKeyLast4: ai.geminiApiKey?.slice(-4) ?? null,
      groqKeyLast4: ai.groqApiKey?.slice(-4) ?? null,
      ollamaModel: ai.ollamaModel,
    };
  })
);
router.post(
  '/ai-config/provider',
  handle((userId, req) => dataStore.setAiProvider(userId, req.body.provider))
);
router.post(
  '/ai-config/gemini-key',
  handle(async (userId, req) => {
    const key: string = req.body.key;
    const result = await pingModel(key);
    if (!result.ok) return result;
    await dataStore.setGeminiApiKey(userId, key);
    await dataStore.setAiProvider(userId, 'gemini');
    return { ok: true };
  })
);
router.post(
  '/ai-config/groq-key',
  handle(async (userId, req) => {
    const key: string = req.body.key;
    const result = await pingGroq(key);
    if (!result.ok) return result;
    await dataStore.setGroqApiKey(userId, key);
    await dataStore.setAiProvider(userId, 'groq');
    return { ok: true };
  })
);
