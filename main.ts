import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { DataStore } from './main/dataStore';
import { ArticlesCache } from './main/articlesCache';
import { registerIpcHandlers, broadcast } from './main/ipcHandlers';
import { createTray } from './main/tray';
import { buildAssetsDir } from './main/paths';
import * as refreshAgent from './main/refreshAgent';
import type { Tray } from 'electron';

// The Vite dev server only exists under `npm run dev`, which is the one launch path that sets
// ELECTRON_IS_DEV — so that env var is the sole signal for loading from http://localhost:5173.
// Every other way of starting the app (a packaged build, or `electron .` / `npm start` after a
// `npm run build`) has no dev server and loads the built files from dist/ instead, so the app runs
// completely standalone. Deliberately NOT keyed on `!app.isPackaged`: an unpackaged run is not the
// same as "a dev server is running," and conflating the two is what forced the server to be up.
const useDevServer = process.env.ELECTRON_IS_DEV === '1';

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

const BG_BY_THEME = { light: '#faf8f5', dark: '#1a1714' } as const;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const dataStore = new DataStore();
const articlesCache = new ArticlesCache();

// Drive nativeTheme from the stored preference (not its 'system' default) as early as possible —
// before any window exists — so the native title-bar area (this window uses titleBarStyle:
// 'hiddenInset') and the very first CSS paint both already agree with the user's choice instead of
// briefly showing the OS's theme and snapping over once things sync up.
nativeTheme.themeSource = dataStore.getSettings().theme;

// Synchronous IPC so preload.ts can stamp <html data-theme> before the page's own scripts run —
// an async invoke() would resolve after first paint and reintroduce exactly the flash this exists
// to prevent. Registered before app.whenReady() since preload can run as soon as a window loads.
ipcMain.on('theme:getInitialSync', (event) => {
  event.returnValue = dataStore.getSettings().theme;
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: BG_BY_THEME[dataStore.getSettings().theme],
    icon: path.join(buildAssetsDir(), 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (useDevServer) {
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
  // dataStore writes are debounced — flush any pending mutation now so a click right before quit
  // isn't silently lost.
  dataStore.flush();
});
