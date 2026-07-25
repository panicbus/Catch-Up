import { app } from 'electron';
import path from 'path';
import fs from 'fs';

/** In dev, keep data at ./data so it's easy to inspect while iterating. Packaged builds use userData. */
function dataDir(): string {
  const dir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataFilePath(): string {
  return path.join(dataDir(), 'catchup-data.json');
}

export function articlesCacheFilePath(): string {
  return path.join(dataDir(), 'articles-cache.json');
}

/** Persisted AI relevance verdicts (keyed by article id) + the daily-classification counter, so a
 * story is classified at most once and cost/quota stays bounded. See classificationStore.ts. */
export function classificationCacheFilePath(): string {
  return path.join(dataDir(), 'classification-cache.json');
}

/** Icons live under `build/` in dev; packaged builds copy them via electron-builder extraResources. */
export function buildAssetsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'build');
  }
  return path.join(__dirname, '..', '..', 'build');
}
