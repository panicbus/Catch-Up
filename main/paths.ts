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

/** Icons live under `build/` in dev; packaged builds copy them via electron-builder extraResources. */
export function buildAssetsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'build');
  }
  return path.join(__dirname, '..', '..', 'build');
}
