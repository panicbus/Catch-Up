/**
 * Bump semver in package.json + package-lock.json (root entries only).
 * Usage: node scripts/bump-version.mjs patch|minor|major
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const kind = process.argv[2];
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: node scripts/bump-version.mjs patch|minor|major');
  process.exit(1);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const parts = String(pkg.version)
  .split('.')
  .map((n) => Number.parseInt(n, 10));
if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
  console.error(`Invalid package.json version: ${pkg.version}`);
  process.exit(1);
}
let [maj, min, pat] = parts;
if (kind === 'major') {
  maj += 1;
  min = 0;
  pat = 0;
} else if (kind === 'minor') {
  min += 1;
  pat = 0;
} else {
  pat += 1;
}
const next = `${maj}.${min}.${pat}`;
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
lock.version = next;
if (lock.packages?.['']) {
  lock.packages[''].version = next;
}
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

process.stdout.write(`${next}\n`);
