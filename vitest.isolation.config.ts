import { defineConfig } from 'vitest/config';

// Deliberately a SEPARATE config from vitest.config.ts. These tests talk to a real database, so
// they must not run as part of the normal `npm test` (which fires on every commit via the
// pre-commit hook) — that would write to the live database on every commit and make the hook slow
// and network-dependent. Run explicitly with `npm run test:isolation`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.isolation.test.ts'],
    // Loads .env so DATABASE_URL is available — the normal suite is pure logic and never needed it.
    setupFiles: ['dotenv/config'],
    // Real network round-trips to a serverless Postgres that may need to wake from idle.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // These share one database; running files in parallel would let one file's cleanup delete
    // another's fixtures.
    fileParallelism: false,
  },
});
