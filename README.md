# Catch Up

A personal news aggregator for macOS. Add topics as **channels**, narrow them with keyword **subchannels**, and read through a calm, non-infinite feed that always tells you when you're caught up — instead of pretending there's always more.

> **Your news. Your pace. All caught up.**

Catch Up is fully local: no account, no server, no telemetry. Everything it stores lives in a JSON file on your machine, and the only network requests it makes are to the news providers you've configured.

---

## Features

- **Channels** — add any topic (a subject, a person, a team, a hobby) and Catch Up pulls matching stories from multiple news providers automatically, refreshed in the background every 30 minutes.
- **Subchannels** — narrow a channel with keyword searches (e.g. a *Music* channel with *Phish* and *Goose* subchannels) without losing the channel's own general coverage; subchannel results **add to** the channel feed rather than replacing it.
- **Smart relevance filtering** — a foundational, zero-cost gate keeps off-topic stories out of each channel (no more politics leaking into *Music*, or a story that merely says "Tech" landing in *Tech*). Optionally, an AI layer (your own free Gemini key) sharpens it further. See [How relevance filtering works](#how-relevance-filtering-works).
- **Local-story deprioritization** — set your home city in Settings and topic/entity channels (e.g. a *Wildfires* channel) quietly deprioritize local stories about places far from you, so a small distant town's story doesn't crowd out the ones near you. Broad category channels are unaffected. Fully offline — no external geocoding call.
- **The Pool** — every channel's stories merged into one chronological feed, filterable by channel, with a configurable how-many-shown limit. For skimming across everything at once instead of channel by channel.
- **Read once, done** — mark a story read and it's gone from the active list; no infinite scroll, no algorithmic reshuffling. A capped, chronological archive keeps the last two weeks around if you want to look back. Unread stories are capped per channel so the "to catch up on" number never gets overwhelming.
- **Pause a channel** — take a break from a channel for 24 hours, 48 hours, a week, or "until I say so." Paused channels stop fetching in the background.
- **Bookmarks** — save stories for later, organized by channel.
- **Roll the dice** — pull a single random unread story from your whole pool when you don't want to pick.
- **Streak tracking** — counts the days you've actually caught up on a channel (cleared its unread to zero), not just days you opened the app, with a growing flame as the streak builds.
- **Rearrange your Home** — drag channel tiles into the order you want.
- **List and grid views, light and dark themes**, and a **menu-bar tray icon** for quick access and background refresh.
- **Fully local** — all data (channels, read state, bookmarks, settings, streak) lives in a JSON file on your machine.

---

## How relevance filtering works

A channel is populated by sending its name to each news provider as a search — and raw search results contain off-topic noise. Catch Up filters every freshly-fetched batch before it reaches your feed, in two stages:

**Stage 1 — the free keyword gate (always on, no key, no cost).** Each channel is auto-classified from its name into either a broad **news category** (Music/Movies → *entertainment*, Tech/AI → *technology*, Politics/Election → *politics*, …) or a specific **topic/entity** (a band, a person, a team). Each candidate story then gets a **soft relevance score**:

- Points *for* looking on-topic — a genuine on-topic keyword ("album", "chip", "senate"), the provider filing it under a matching section, or the provider's own topic **tags** naming the subject.
- Points *against* — an anti-topic keyword (a movie word in a Politics story), or a section that belongs to a *different* category.

The scores add up, so one strong off-topic signal drops a story while a strong on-topic signal can rescue a borderline one. Two tiers of strictness apply: **main channels are lenient** (kept unless there's a clear off-topic signal, so real stories that never repeat the channel word survive), while **subchannels are strict** (the specific term must actually appear). The ambiguous channel word itself ("tech") is used only to classify the channel — it never counts as proof a story is on-topic, which is what keeps "Virginia Tech" sports out of a technology channel.

**Stage 2 — optional AI (your own Gemini key).** When enabled in Settings, freshly-fetched stories that survive Stage 1 are run past a model that judges *meaning*, not keywords — dropping the tangential/wrong-sense results the heuristic can't catch. Verdicts are cached per story and bounded by a daily cap, so it stays cheap (and free-tier friendly). Every AI failure path degrades silently to the Stage-1 result — the app never breaks or blocks on the model.

**Deduplication** runs on every merge: stories are collapsed by URL and by a filler-word-insensitive headline key, so the same wire story republished under different URLs — or two headlines differing only by a word like *in*/*on* — appear once.

**Local-story deprioritization (topic/entity channels only).** When you've set a home city in Settings, Stage 1's score gets one more input: the story's title/snippet is scanned for place names against a bundled city gazetteer, and a story whose nearest mentioned place is far from home gets a mild penalty (a strong on-topic story survives regardless of distance; only borderline ones get tipped out). Broad category channels never apply this — they're supposed to show geographic variety.

---

## Tech stack

- **Electron** — desktop shell (main process + sandboxed renderer, typed IPC bridge)
- **React + TypeScript** — UI, via **Vite**
- **React Router** (hash routing) for in-app navigation
- **Plain CSS** (no framework) — see `src/styles/variables.css` for the design tokens
- **News** fetched from **6 providers in parallel** per channel/subchannel search — NewsData.io, The Guardian Open Platform, GNews, and NYTimes (all optional, free-tier, keyed), plus Google News (RSS) and Hacker News (no key needed, on by default) — deliberately broad so no single outlet's editorial slant dominates the feed
- **AI relevance** — provider-agnostic classifier shipping on Google Gemini's free tier (swappable), fully optional

---

## Getting started

There are two ways to run Catch Up on another machine. Pick the one that fits.

### Option A — just run the app (for testers, no development)

If someone sent you a build, or you grabbed one from the [Releases page](https://github.com/panicbus/Catch-Up/releases):

1. Download the `.dmg` from the latest release.
2. Open it and drag **Catch Up** into your Applications folder.
3. Launch it. The release build is **signed and notarized**, so it opens without Gatekeeper warnings — no right-click-to-open workaround needed.

That's it — the news-provider API keys are already bundled into the release build, so there's nothing to configure. (AI relevance filtering is off by default; if you want it, turn it on in **Settings** and paste your own free Gemini key when prompted.)

**Requirements:** macOS 12 (Monterey) or newer.

### Option B — run from source (for developers)

#### Prerequisites

- **Node.js 20+** (18 also works)
- **macOS** — the packaged build targets macOS only; the dev server itself is cross-platform, but the tray/packaging paths assume macOS

#### 1. Clone and install

```bash
git clone https://github.com/panicbus/Catch-Up.git
cd Catch-Up
npm install
```

#### 2. Add your API keys

Copy the example env file and fill in keys for whichever providers you want. **All keyed providers are optional** — Catch Up works with zero, one, or all four configured; each is queried independently and a missing or rate-limited key is simply skipped. Google News and Hacker News need no key and are on by default.

```bash
cp .env.example .env
# then edit .env
```

| Provider          | Key required? | Free tier                              | Sign up |
|-------------------|:-------------:|----------------------------------------|---------|
| NewsData.io       | Yes           | 200 credits/day                        | https://newsdata.io/register |
| The Guardian      | Yes           | Free, commercial use allowed           | https://open-platform.theguardian.com/access/ |
| GNews             | Yes           | 100 requests/day                       | https://gnews.io/register |
| NYTimes           | Yes           | Free, generous daily quota             | https://developer.nytimes.com/ |
| Google News (RSS) | No            | —                                      | — |
| Hacker News       | No            | —                                      | — |
| **Gemini** (AI filtering, optional) | No, in-app | Generous free tier | https://aistudio.google.com/apikey |

> **Gemini note:** you can set `GEMINI_API_KEY` in `.env`, but you don't have to — the app also lets you paste a key in **Settings** at runtime. AI filtering is entirely optional; without it, the free keyword gate runs alone. Be aware Gemini's *free* tier may use submitted data (article titles/snippets) to improve Google's products; the paid tier does not.

#### 3. Run in development

```bash
npm run dev
```

This compiles the Electron main process, starts the Vite dev server, and launches the app once both are ready.

- The **renderer** (`src/**`) hot-reloads on save.
- Changes to the **main process** (`main.ts`, `preload.ts`, `main/**`) require **restarting `npm run dev`** — they don't hot-reload.

---

## Building and releasing

| Task | Command |
|------|---------|
| Unsigned local `.app` (arm64) into `release/`, for a quick local test | `npm run pack:mac:dir` |
| Full local signed build (needs your certs + notarization env) | `npm run release:mac` |

**Signed, notarized DMG for distribution** is produced by GitHub Actions, not locally (local signing is blocked on recent macOS by an unremovable `com.apple.provenance` extended attribute). Push a version tag and the workflow builds, signs, notarizes, and attaches the DMG to a GitHub Release:

```bash
npm run bump:minor        # or bump:patch / bump:major — updates package.json
git commit -am "…"
git tag v0.11.0           # tag must match the new version
git push && git push origin v0.11.0
```

The DMG then appears at `https://github.com/panicbus/Catch-Up/releases/tag/v0.11.0`. The release build bundles the news-provider keys from repository secrets (Gemini is intentionally **not** bundled — each user adds their own in-app). See `.github/workflows/release.yml` and `RELEASE.md` for the required secrets and full details.

---

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Compile main process, start Vite, launch the app (renderer hot-reloads) |
| `npm run typecheck` | Type-check both the renderer and the Electron main process |
| `npm run test` | Run the main-process test suite once (relevance/locality/refresh pipeline) |
| `npm run test:watch` | Run the test suite in watch mode |
| `npm run build` | Production build of the renderer + compiled main process |
| `npm run start` | Build, then launch the built app |
| `npm run pack:mac:dir` | Build and package an unsigned macOS `.app` (arm64) into `release/` |
| `npm run release:mac` | Full local signed/notarized build (requires signing env) |
| `npm run icons:mac` | Regenerate app/tray icons from the source SVG |
| `npm run bump:patch` / `bump:minor` / `bump:major` | Bump the version in `package.json` |

---

## How it works

Catch Up is a standard Electron app split into three parts, connected by a single typed contract:

- **`main.ts` / `main/*.ts`** — the main process. Owns the local JSON data store (`dataStore.ts`), the fetched-articles cache (`articlesCache.ts`), the background refresh loop (`refreshAgent.ts`), the relevance stages (`aiRelevance.ts`, `providers/relevance.ts`, `providers/classifier.ts`, `classificationStore.ts`), and the news provider integrations (`main/providers/*`).
- **`preload.ts`** — a sandboxed bridge exposing a frozen `window.api` object to the renderer; nothing else from Node/Electron is reachable from the UI.
- **`src/**`** — the React renderer (everything you see).
- **`ipc-contract.ts`** — the single source of truth for every type and IPC channel shared across all three; the preload bridge, the renderer's API wrapper, and the main-process handlers all implement this same contract.

**News fetching:** on a 30-minute cycle (and on-demand via the Refresh button), each channel's name — plus each subchannel's name appended to the channel name — is queried against every configured provider in parallel. Results pass through the relevance gate (and optional AI), are deduped by URL and headline, cached locally (capped at 300 articles / 14 days per channel, with a tighter cap on unread), and merged into the UI. Subchannel searches are staggered across background cycles (roughly a third of a channel's subchannels refresh per cycle) to keep request volume down; a manual refresh, or a newly added channel/subchannel, always fetches immediately.

All user data lives in a single local JSON file (see `main/paths.ts` for its location); the fetched-articles cache is a **separate** file so frequent background writes never risk the durable user-data file. Nothing leaves your machine except the outbound requests to the news providers you've configured (and, if you enable AI filtering, the article titles/snippets sent to Gemini).

---

## Project structure

```
main.ts, preload.ts          Electron entry points
main/
  dataStore.ts               Local JSON store: channels, settings, bookmarks, read state, streak
  articlesCache.ts           Fetched-article cache, capped/pruned/deduped per channel
  refreshAgent.ts            Background refresh loop + per-channel fetch orchestration
  aiRelevance.ts             Relevance stage: keyword gate first, then the AI classifier
  classificationStore.ts     AI verdict cache + daily cap (cost/quota control)
  ipcHandlers.ts             All ipcMain.handle registrations
  providers/
    channelProfiles.ts       Auto-classifies a channel into a category + keyword rules
    relevance.ts             The free, soft additive relevance score + two-tier gate
    classifier.ts            Provider-agnostic AI relevance call (Gemini today)
    dedupe.ts                URL + fuzzy-headline dedup keys
    newsdata.ts, guardian.ts, gnews.ts, nytimes.ts, googleNewsRss.ts, hackerNews.ts   6 source integrations
    registry.ts, cooldown.ts, ...                                                     Orchestration + rate-limit handling
  tray.ts                    Menu-bar tray icon
ipc-contract.ts              Shared types + IPC channel definitions
src/
  components/                Feature areas: Home, Channel, Pool, Bookmarks, Settings, Onboarding, Layout, common
  hooks/                     Data-fetching and subscription hooks (one per IPC-backed resource)
  services/api.ts            Renderer-side wrapper around the preload bridge
  styles/                    Design tokens and global styles
```

---

## Data & privacy

Catch Up has no account system, doesn't sync to a server, and doesn't collect telemetry. Everything it stores lives in a local JSON file on your machine. The only network requests it makes are:

- the news-provider API calls for the providers you've configured, and
- if — and only if — you turn on AI relevance filtering, the article titles/snippets sent to your chosen AI provider (Gemini) to judge relevance.

Turn AI filtering off (the default) and nothing but the news-provider requests ever leaves your machine.

The home-city lookup used for local-story deprioritization runs entirely offline against a bundled place database — no geocoding API, no network call, no key. That database is a trimmed extract of [GeoNames](https://www.geonames.org/) (all populated places with population > 5,000), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
