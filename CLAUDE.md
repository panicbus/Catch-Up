# Catch Up

Electron + React + Vite + TypeScript desktop news app. Renderer in `src/`, Electron main process in `main.ts` / `main/`, IPC bridge in `preload.ts` with the contract in `ipc-contract.ts`.

## Versioning

Bump with the repo's own scripts, not `npm version`:

```bash
npm run bump:patch    # or bump:minor / bump:major
```

`scripts/bump-version.mjs` writes only `package.json` and `package-lock.json` (root entries) — it makes no commit and no tag, so it composes cleanly with a normal commit.

**Nearly every batch of work here gets bumped.** When torn between a patch bump and skipping, bump.

## Committing

- `data/` and `.env` are both gitignored. `data/` holds the user's real content and `.env` holds provider API keys — neither may ever be committed.
- `packaged.env` is generated at release time by `scripts/make-packaged-env.mjs`; don't hand-edit it.

## Restart required after main-process changes

`main.ts`, `preload.ts`, and anything under `main/` do **not** hot-reload. A running `npm run dev` session keeps the old compiled `dist-electron/` until it's restarted. Renderer changes under `src/` do hot-reload.

## Releasing

See [RELEASE.md](RELEASE.md) for the full process. In short: the signed, notarized DMG is built by GitHub Actions (`.github/workflows/release.yml`) on a `macos-14` runner, with signing certs and provider keys stored as repository Secrets. `npm run release:mac` is the local equivalent but doesn't notarize.
