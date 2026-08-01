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
import { resolveUser } from './auth';
import { runChannel, runAll } from './refreshAgent';
import { getProviderStatus } from '../main/providers/registry';
import { pingModel } from '../main/providers/classifier';
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
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// A plain "did the password gate let this through" check — used only by the frontend's password
// screen to validate what someone typed before storing it. No user resolution needed here.
router.get('/ping', (_req, res) => res.json({ ok: true }));

// --- Onboarding ------------------------------------------------------------------------------

router.get('/onboarding', handle((userId) => dataStore.getOnboardingStatus(userId)));
router.post('/onboarding/complete', handle((userId, req) => dataStore.completeOnboarding(userId, req.body.names ?? [])));

// --- Channels --------------------------------------------------------------------------------

router.get('/channels', handle((userId) => dataStore.getChannels(userId)));

router.post(
  '/channels',
  handle(async (userId, req) => {
    const channel = await dataStore.createChannel(userId, req.body.name);
    void runChannel(userId, channel.id); // fire-and-forget first fetch, same as the desktop app
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
    void runChannel(userId, channelId); // fire-and-forget first fetch for the new subchannel
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
    const { channelId, subchannelId, limit } = req.query as { channelId: string; subchannelId?: string; limit?: string };
    const articles = await articlesCache.getArticles(userId, channelId, subchannelId ?? null, limit ? Number(limit) : undefined);
    return { articles };
  })
);
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
    const [enabled, hasKey] = await Promise.all([dataStore.getAiEnabled(userId), dataStore.hasGeminiApiKey(userId)]);
    // A key from the server's own env (dev/shared) counts as configured too, same as the desktop
    // app's "don't needlessly prompt the modal" behavior.
    return { enabled, keyConfigured: hasKey || !!process.env.GEMINI_API_KEY?.trim() };
  })
);
router.post('/ai-config/enabled', handle((userId, req) => dataStore.setAiEnabled(userId, req.body.enabled)));
router.post(
  '/ai-config/key',
  handle(async (userId, req) => {
    const key: string = req.body.key;
    const result = await pingModel(key);
    if (!result.ok) return result;
    await dataStore.setGeminiApiKey(userId, key);
    await dataStore.setAiEnabled(userId, true);
    return { ok: true };
  })
);
