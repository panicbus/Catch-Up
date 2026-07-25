// Generates packaged.env (gitignored) from .env, containing ONLY the news-provider keys, so the
// packaged app ships with working providers. The personal Gemini key is deliberately excluded —
// buyers enter their own via the in-app modal, and bundling it would burn the developer's quota.
// Run before electron-builder (see the release:mac script); packaged.env is copied into the app via
// extraResources and read by main.ts's loadEnv() when app.isPackaged.
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, '.env');
const OUT = path.join(ROOT, 'packaged.env');

// Whitelist: exactly the provider keys to embed. Gemini is intentionally NOT here.
const BUNDLE_KEYS = ['NEWSDATA_API_KEY', 'GUARDIAN_API_KEY', 'GNEWS_API_KEY', 'NYTIMES_API_KEY'];

if (!fs.existsSync(SRC)) {
  console.error('[make-packaged-env] No .env found — cannot bundle provider keys for the release.');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(SRC, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
}

const out = ['# Bundled provider keys for the packaged app — generated from .env. DO NOT COMMIT.'];
let n = 0;
const missing = [];
for (const k of BUNDLE_KEYS) {
  if (env[k]) {
    out.push(`${k}=${env[k]}`);
    n += 1;
  } else {
    missing.push(k);
  }
}
fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log(`[make-packaged-env] wrote ${n} provider key(s) to packaged.env (Gemini excluded).`);
if (missing.length) console.warn(`[make-packaged-env] WARNING: missing in .env → ${missing.join(', ')}`);
