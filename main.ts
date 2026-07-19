import { app, BrowserWindow, nativeImage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { DataStore } from './main/dataStore';
import { ArticlesCache } from './main/articlesCache';
import { registerIpcHandlers, broadcast } from './main/ipcHandlers';
import { createTray } from './main/tray';
import { buildAssetsDir } from './main/paths';
import * as refreshAgent from './main/refreshAgent';
import type { Tray } from 'electron';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged || !!process.env.ELECTRON_IS_DEV;

/** Minimal .env loader (KEY=VALUE per line) — avoids adding a dependency for a handful of API keys. */
function loadEnv(): void {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const dataStore = new DataStore();
const articlesCache = new ArticlesCache();

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#faf8f5',
    icon: path.join(buildAssetsDir(), 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    void win.loadURL('http://localhost:5173');
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  return win;
}

void app.whenReady().then(() => {
  registerIpcHandlers({ dataStore, articlesCache });

  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(path.join(buildAssetsDir(), 'icon.png'));
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  tray = createTray(
    () => mainWindow,
    createWindow,
    () => void refreshAgent.runAll({ dataStore, articlesCache, broadcast })
  );

  createWindow();

  refreshAgent.start({ dataStore, articlesCache, broadcast });
});

// The background refresh agent must keep running whether or not a window is open — the tray
// keeps the process alive on every platform, so we deliberately do NOT quit here.
app.on('window-all-closed', () => {
  // no-op by design
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  refreshAgent.stop();
  tray?.destroy();
});
