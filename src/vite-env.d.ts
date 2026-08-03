/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Base address of the hosted backend (e.g. "https://catch-up-dcti.onrender.com") — only used by
   * the web build (src/services/api.ts); the desktop build talks to its local Electron bridge
   * instead and never reads this. Unset in dev, where Vite's own proxy or a same-origin backend is
   * assumed; set at build time in Vercel's project settings for the deployed site. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
