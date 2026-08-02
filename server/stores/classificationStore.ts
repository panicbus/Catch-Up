/** Database-backed replacement for main/classificationStore.ts, implementing the same
 * ClassificationStoreLike interface main/aiRelevance.ts already depends on — same two jobs, same
 * rules: cache a verdict per story so it's never reclassified, and cap new classifications per day
 * so a runaway refresh can't blow past Gemini's free-tier quota.
 *
 * aiRelevance.ts treats its cache key as one opaque string (`${channelId}:${articleId}`) — this
 * class accepts that same opaque string (matching the interface exactly) but stores it as two real
 * columns (see the classification_cache table), splitting on the first colon internally. */

import { prisma } from '../db';
import type { ClassificationStoreLike } from '../../main/classificationStore';

const MAX_AGE_DAYS = 14;
const DAILY_CAP = Number(process.env.AI_DAILY_CAP) || 3000;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function splitCacheKey(id: string): { channelId: string; articleId: string } {
  const i = id.indexOf(':');
  return { channelId: id.slice(0, i), articleId: id.slice(i + 1) };
}

export class ServerClassificationStore implements ClassificationStoreLike {
  constructor(private readonly userId: string) {}

  /** One query for the whole batch. This used to be a per-article findUnique called in a loop by
   * aiRelevance.ts — one network round-trip to the database per story, which at ~60 stories a search
   * added seconds to every single refresh. Grouped by channelId because the composite key is
   * (userId, channelId, articleId); in practice one filterRelevant call is always a single channel,
   * but grouping keeps this correct if that ever stops being true. */
  async getVerdicts(ids: string[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    if (ids.length === 0) return out;

    const byChannel = new Map<string, string[]>();
    for (const id of ids) {
      const { channelId, articleId } = splitCacheKey(id);
      const list = byChannel.get(channelId);
      if (list) list.push(articleId);
      else byChannel.set(channelId, [articleId]);
    }

    const rows = await prisma.classificationCache.findMany({
      where: {
        userId: this.userId,
        OR: [...byChannel].map(([channelId, articleIds]) => ({ channelId, articleId: { in: articleIds } })),
      },
      select: { channelId: true, articleId: true, keep: true },
    });

    for (const r of rows) out.set(`${r.channelId}:${r.articleId}`, r.keep);
    return out;
  }

  async remainingDailyBudget(): Promise<number> {
    const row = await prisma.classificationDailyBudget.findUnique({
      where: { userId_date: { userId: this.userId, date: new Date(todayStr()) } },
    });
    if (!row) return DAILY_CAP;
    return Math.max(0, DAILY_CAP - row.count);
  }

  async recordClassifications(entries: { id: string; keep: boolean }[]): Promise<void> {
    if (entries.length === 0) return;
    const today = todayStr();

    await prisma.$transaction(
      entries.map((e) => {
        const { channelId, articleId } = splitCacheKey(e.id);
        return prisma.classificationCache.upsert({
          where: { userId_channelId_articleId: { userId: this.userId, channelId, articleId } },
          create: { userId: this.userId, channelId, articleId, keep: e.keep },
          update: { keep: e.keep, classifiedAt: new Date() },
        });
      })
    );

    await prisma.classificationDailyBudget.upsert({
      where: { userId_date: { userId: this.userId, date: new Date(today) } },
      create: { userId: this.userId, date: new Date(today), count: entries.length },
      update: { count: { increment: entries.length } },
    });

    await this.pruneOld();
  }

  private async pruneOld(): Promise<void> {
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    await prisma.classificationCache.deleteMany({ where: { userId: this.userId, classifiedAt: { lt: cutoff } } });
  }
}
