import { defineConfig } from 'vitest/config';

// Covers main/ (Electron-agnostic providers/relevance/locality/refresh pipeline), server/'s own PURE
// logic (no DB, no network), and src/'s pure decision logic (extracted selector/pure-function
// modules — e.g. NewsFeed's read-marking rules — kept deliberately separate from the components that
// use them specifically so they're plain-data-in/plain-data-out and reachable here). No jsdom/DOM
// environment: nothing under src/ that this actually runs touches a real DOM, on purpose — a
// component test would need its own jsdom project, which doesn't exist yet.
// server/**/*.db.test.ts is deliberately excluded here: those hit a real live database and run
// separately via vitest.db.config.ts (npm run test:isolation), specifically so the normal fast suite
// (this one, fired on every commit by the pre-commit hook) never becomes slow or network-dependent.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['main/**/*.test.ts', 'server/**/*.test.ts', 'src/**/*.test.ts'],
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
