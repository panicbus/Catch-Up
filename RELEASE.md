# Releasing Catch Up (macOS)

The signed, notarized DMG is built by GitHub Actions (`.github/workflows/release.yml`) on a
`macos-14` runner — local signing is blocked on macOS 26+ by an unremovable `com.apple.provenance`
xattr that `codesign` rejects.

## One-time setup: repository Secrets

Add these under **GitHub → repo → Settings → Secrets and variables → Actions → New repository secret**.

### Signing certificate
1. Open **Keychain Access**, find **"Developer ID Application: NICHOLAS FREEDOM CRISAFULLI
   (KB8N3Q3ZAF)"** under *login → My Certificates* (expand it so the private key is included).
2. Right-click → **Export…** → save as `cert.p12`, set an export password.
3. Base64-encode it and copy to clipboard:
   ```sh
   base64 -i cert.p12 | pbcopy
   ```
4. Add secrets:
   - `MAC_CERT_P12_BASE64` — paste the base64 from step 3
   - `MAC_CERT_PASSWORD` — the export password from step 2

### Notarization
- `APPLE_ID` — your Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD` — from [appleid.apple.com](https://account.apple.com) → Sign-In &
  Security → App-Specific Passwords (the same one in your local `.env.notarize`)
- `APPLE_TEAM_ID` — `KB8N3Q3ZAF`

### Bundled provider keys (the values in your local `.env`)
- `NEWSDATA_API_KEY`
- `GUARDIAN_API_KEY`
- `GNEWS_API_KEY`
- `NYTIMES_API_KEY`

(Gemini is **not** bundled — each user adds their own key via Settings → AI filtering.)

## Cutting a release

```sh
npm run bump:patch      # or bump:minor / bump:major
git commit -am "Release vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

The tagged push runs the workflow: it builds, signs with Developer ID, notarizes, staples, and
attaches `Catch Up-X.Y.Z-universal.dmg` to a new GitHub Release. Download it there and upload to
Lemon Squeezy. (You can also trigger the workflow manually from the **Actions** tab — that run
uploads the DMG as a build artifact instead of creating a Release.)

## Local builds (for testing only)

- `npm run pack:mac:dir` — quick unsigned `.app` (no DMG).
- `npm run release:mac` — full build; signs + notarizes **only if** run on macOS 14/15 with
  `.env` (provider keys) and `.env.notarize` (Apple creds) present:
  ```sh
  set -a; source .env.notarize; set +a
  npm run release:mac
  ```
  On macOS 26+ this produces an unsigned DMG (Gatekeeper-blocked for other users).

## If the universal build ever fails signing on the runner

Switch `build.mac.target[0].arch` in `package.json` from `["universal"]` to `["arm64", "x64"]` to
produce two per-architecture DMGs (no lipo merge). Both cover Intel + Apple Silicon.
