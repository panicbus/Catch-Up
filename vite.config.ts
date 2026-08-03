import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8')
) as { version: string };

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // No auto-injected register script — main.tsx registers manually, gated on the same `isWeb`
      // check used everywhere else (see src/main.tsx), so the packaged Electron app never gets a
      // service worker at all. It talks to a local bridge, not HTTP, and doesn't need one.
      injectRegister: null,
      manifest: {
        name: 'Catch Up',
        short_name: 'Catch Up',
        description: 'Your news. Your pace. All caught up.',
        start_url: '.',
        display: 'standalone',
        background_color: '#f5efe3', // --bg, light theme (src/styles/variables.css)
        theme_color: '#e4483a', // --accent
        icons: [
          { src: 'pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built app shell ONLY — this app has no offline data support and isn't
        // gaining any here; the service worker exists purely for installability and fast repeat
        // asset loads. The backend is a separate origin (Render), so Workbox would never precache
        // it by default, but there is deliberately no runtime-caching rule added for it either —
        // every API call must keep going to the network, live, every time.
        //
        // Deliberately narrower than "every js/css/html/png" — the Home background illustration
        // (assets/diner-bg-*.png) is a 2.4MB decorative image that lives under assets/ alongside
        // the hashed JS/CSS bundles, and it's the only thing that pattern would additionally catch.
        // It's non-critical (mix-blend-mode overlay at low opacity) and loads fine on demand from
        // the network instead of bloating the install-time precache; ordinary HTTP caching still
        // covers it on repeat visits.
        globPatterns: ['**/*.{js,css,html}', 'favicon.svg', 'pwa-icon-*.png', 'apple-touch-icon.png'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
