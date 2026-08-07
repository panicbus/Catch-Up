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

export const router = Router();

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
      res.json(result ?? { ok: true });
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
    const { channelId, channelIds, subchannelId, limit } = req.query as {
      channelId?: string;
      channelIds?: string;
      subchannelId?: string;
      limit?: string;
    };
    const parsedLimit = limit ? Number(limit) : undefined;
    // `channelIds` (comma-separated) is The Pool's path: it wants a slice of every channel at once,
    // and used to issue one request PER channel to get it. One query with an `IN` replaces all of
    // them. `channelId` stays the single-channel path used by the channel view.
    if (channelIds) {
      const ids = channelIds.split(',').map((s) => s.trim()).filter(Boolean);
      const articles = await articlesCache.getArticlesForChannels(userId, ids, parsedLimit);
      return { articles };
    }
    const articles = await articlesCache.getArticles(userId, channelId ?? '', subchannelId ?? null, parsedLimit);
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
