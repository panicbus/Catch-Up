import fs from 'fs';
import { classificationCacheFilePath } from './paths';

/** Persisted AI relevance verdicts + a daily-classification counter — the cost/quota control the AI
 * filter depends on. Two jobs:
 *   1. CACHE-BY-ID (non-negotiable): every article is classified at most once. The 30-min refresh
 *      re-fetches the same stories constantly; without this we'd re-classify them every cycle and
 *      blow the quota/cost ~50x. Verdicts are pruned on the same 14-day horizon as the article cache.
 *   2. DAILY CAP (safety valve): bounds how many NEW classifications happen per day, so a firehose of
 *      channels — or many UAT testers on one shared free key — can't run past the free tier. Once the
 *      cap is hit, the AI filter falls back to the free heuristic for the rest of the day.
 *
 * Kept in main/ (not the pure providers/ folder) because it touches the filesystem; the pure API call
 * lives in providers/classifier.ts. */

const MAX_AGE_DAYS = 14;
// Overridable so it can be sized to whatever tier's daily quota is in play. Default is comfortable
// for a single heavy user on Gemini's free tier and conservative enough for a small shared-key UAT.
const DAILY_CAP = Number(process.env.AI_DAILY_CAP) || 3000;

interface Verdict {
  keep: boolean;
  at: string; // ISO — for age pruning
}

interface StoreFile {
  schemaVersion: 1;
  verdicts: Record<string, Verdict>;
  daily: { date: string; count: number };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyFile(): StoreFile {
  return { schemaVersion: 1, verdicts: {}, daily: { date: todayStr(), count: 0 } };
}

export class ClassificationStore {
  private data: StoreFile;
  private readonly filePath: string;

  constructor(filePath: string = classificationCacheFilePath()) {
    this.filePath = filePath;
    this.data = this.read();
    this.prune();
  }

  private read(): StoreFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoreFile;
      if (parsed.schemaVersion !== 1 || !parsed.verdicts || !parsed.daily) return emptyFile();
      return parsed;
    } catch {
      return emptyFile();
    }
  }

  private write(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.warn('[classificationStore] write failed', err);
    }
  }

  private prune(): void {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const [id, v] of Object.entries(this.data.verdicts)) {
      if (new Date(v.at).getTime() < cutoff) {
        delete this.data.verdicts[id];
        changed = true;
      }
    }
    if (changed) this.write();
  }

  /** A cached verdict for this article, or undefined if it's never been classified. */
  getVerdict(id: string): boolean | undefined {
    return this.data.verdicts[id]?.keep;
  }

  /** How many NEW articles may still be classified today (0 once the cap is hit). Resets at UTC
   * midnight. */
  remainingDailyBudget(): number {
    if (this.data.daily.date !== todayStr()) return DAILY_CAP; // new day, not yet reset to disk
    return Math.max(0, DAILY_CAP - this.data.daily.count);
  }

  /** Persist verdicts for freshly-classified articles and count them against today's budget. Cached
   * hits must NOT be passed here — only genuinely new classifications count toward the cap. */
  recordClassifications(entries: { id: string; keep: boolean }[]): void {
    if (entries.length === 0) return;
    const today = todayStr();
    if (this.data.daily.date !== today) {
      this.data.daily = { date: today, count: 0 };
      // The app runs for weeks in the tray without restarting, so prune here on each day-rollover
      // (not just in the constructor) to keep verdicts from accumulating unbounded during a session.
      this.prune();
    }
    const at = new Date().toISOString();
    for (const e of entries) this.data.verdicts[e.id] = { keep: e.keep, at };
    this.data.daily.count += entries.length;
    this.write();
  }
}
