# Catch Up

A personal news aggregator for macOS. Add topics as channels, narrow them with keyword-based subchannels, and read through a calm, non-infinite feed that always tells you when you're caught up — instead of pretending there's always more.

Your news. Your pace. All caught up.

## Features

- **Channels** — add any topic (a name, a person, a team, a hobby) and Catch Up pulls matching stories from multiple news providers automatically, refreshed in the background every 30 minutes.
- **Subchannels** — narrow a channel with keyword searches (e.g. a "Music" channel with "Phish" and "Goose" subchannels) without losing the channel's own general coverage; subchannel results add to the channel feed rather than replacing it.
- **The Pool** — every channel's stories merged into one chronological feed, filterable by channel, with a configurable how-many-shown limit. For skimming across everything at once instead of channel by channel.
- **Read once, done** — mark a story read and it's gone from the active list; no infinite scroll, no algorithmic reshuffling. A capped, chronological "read stories" archive keeps the last two weeks around if you want to look back.
- **Bookmarks** — save stories for later, organized by channel.
- **Roll the dice** — pull a single random unread story from your whole pool when you don't want to pick.
- **Streak tracking** — counts days you've actually caught up on a channel (cleared its unread stories to zero), not just days you opened the app.
- **List and grid views**, light and dark themes, and a menu-bar tray icon for quick access and background refresh.
- **Fully local** — all data (channels, read state, bookmarks, settings) lives in a JSON file on your machine. No account, no server, no telemetry.

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell (main process + sandboxed renderer, typed IPC bridge)
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) — UI, via [Vite](https://vitejs.dev/)
- [React Router](https://reactrouter.com/) (hash routing) for in-app navigation
- Plain CSS (no framework) — see `src/styles/variables.css` for the design tokens
- News fetched from [NewsData.io](https://newsdata.io/), [The Guardian Open Platform](https://open-platform.theguardian.com/), and [GNews](https://gnews.io/) — all optional, free-tier friendly, and queried in parallel per channel/subchannel search

## Getting started

### Prerequisites

- Node.js 18+
- macOS (the packaged build currently targets macOS only; the dev server itself is cross-platform)

### Setup

```bash
git clone <this-repo>
cd catch-up-app
npm install
```

Copy `.env.example` to `.env` and add API keys for whichever providers you want (all are optional — Catch Up works with zero, one, two, or three configured; each is queried independently and a missing/rate-limited key is simply skipped):

```bash
cp .env.example .env
```

| Provider | Free tier | Sign up |
|---|---|---|
| NewsData.io | 200 credits/day | https://newsdata.io/register |
| The Guardian | Free, no commercial-use restriction | https://open-platform.theguardian.com/access/ |
| GNews | 100 requests/day | https://gnews.io/register |

### Run in development

```bash
npm run dev
```

This compiles the Electron main process, starts the Vite dev server, and launches the app once both are ready. The renderer (`src/**`) hot-reloads on save; changes to the main process (`main.ts`, `preload.ts`, `main/**`) require restarting `npm run dev`.

### Other scripts

| Script | What it does |
|---|---|
| `npm run typecheck` | Type-checks both the renderer and Electron main process |
| `npm run build` | Production build of the renderer + compiled main process |
| `npm run start` | Build, then launch the built app |
| `npm run pack:mac:dir` | Build and package an unsigned macOS `.app` (arm64) into `release/` |
| `npm run icons:mac` | Regenerate app/tray icons from `build/icon-source.svg` |
| `npm run bump:patch` / `bump:minor` / `bump:major` | Bump the version in `package.json` |

## How it works

Catch Up is a standard Electron app split into three parts, connected by a single typed contract:

- **`main.ts` / `main/*.ts`** — the main process. Owns the local JSON data store (`dataStore.ts`), the fetched-articles cache (`articlesCache.ts`), the background refresh loop (`refreshAgent.ts`), and the news provider integrations (`main/providers/*`).
- **`preload.ts`** — a sandboxed bridge exposing a frozen `window.api` object to the renderer; nothing else from Node/Electron is reachable from the UI.
- **`src/**`** — the React renderer (everything you see).
- **`ipc-contract.ts`** — the single source of truth for every type and IPC channel shared across all three; the preload bridge, the renderer's API wrapper, and the main-process handlers all implement this same contract.

News fetching: on a 30-minute cycle (and on-demand via the Refresh button), each channel's name — plus each of its subchannels' name appended to the channel name — is queried against every configured provider in parallel. Results are deduped by URL and normalized title, cached locally (capped at 300 articles / 14 days per channel), and merged into the UI. Subchannel searches are staggered across background cycles (roughly a third of a channel's subchannels refresh per cycle) to keep request volume down; a manual refresh or a newly added channel/subchannel always fetches immediately regardless.

All user data — channels, subchannels, read state, bookmarks, settings, streak — lives in a single local JSON file (see `main/paths.ts` for its location); the fetched-articles cache is a separate file so frequent background writes never risk the durable user-data file. Nothing leaves your machine except the outbound requests to whichever news providers you've configured.

## Project structure

```
main.ts, preload.ts          Electron entry points
main/
  dataStore.ts                Local JSON store: channels, settings, bookmarks, read state, streak
  articlesCache.ts            Fetched-article cache, capped/pruned per channel
  refreshAgent.ts             Background refresh loop + per-channel fetch orchestration
  ipcHandlers.ts               All ipcMain.handle registrations
  providers/                  NewsData.io / Guardian / GNews integrations + dedupe/cooldown logic
  tray.ts                     Menu-bar tray icon
ipc-contract.ts               Shared types + IPC channel definitions
src/
  components/                 Feature areas: Home, Channel, Pool, Bookmarks, Settings, Onboarding, Layout, common
  hooks/                      Data-fetching and subscription hooks (one per IPC-backed resource)
  services/api.ts             Renderer-side wrapper around the preload bridge
  styles/                     Design tokens and global styles
```

## Data & privacy

Catch Up doesn't have an account system, doesn't sync to a server, and doesn't collect telemetry. Everything it stores lives in a local JSON file on your machine, and the only network requests it makes are the news-provider API calls you've configured.
