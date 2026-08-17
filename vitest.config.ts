import { defineConfig } from 'vitest/config';

// Covers main/ (Electron-agnostic providers/relevance/locality/refresh pipeline) — the app's only
// non-trivial logic today — plus server/'s own PURE logic (no DB, no network). server/**/*.db.test.ts
// is deliberately excluded here: those hit a real live database and run separately via
// vitest.db.config.ts (npm run test:isolation), specifically so the normal fast suite (this one,
// fired on every commit by the pre-commit hook) never becomes slow or network-dependent.
// No renderer/component tests yet; add a jsdom project here if that changes.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['main/**/*.test.ts', 'server/**/*.test.ts'],
    // Vitest's own sensible defaults (node_modules, dist, etc.) plus the DB-test carve-out above —
    // specifying `exclude` at all replaces those defaults rather than adding to them, so they're
    // repeated here rather than silently lost.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      'server/**/*.db.test.ts',
    ],
  },
});
