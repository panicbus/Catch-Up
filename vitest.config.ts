import { defineConfig } from 'vitest/config';

// Covers main/ (Electron-agnostic providers/relevance/locality/refresh pipeline) — the app's only
// non-trivial logic today. No renderer/component tests yet; add a jsdom project here if that changes.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['main/**/*.test.ts'],
  },
});
