/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Base address of the hosted backend (e.g. "https://catch-up-dcti.onrender.com") — only used by
   * the web build (src/services/api.ts); the desktop build talks to its local Electron bridge
   * instead and never reads this. Unset in dev, where Vite's own proxy or a same-origin backend is
   * assumed; set at build time in Vercel's project settings for the deployed site. */
  readonly VITE_API_BASE_URL?: string;
  /** Google OAuth Client ID used by src/components/Auth/SignInScreen.tsx — a public identifier, not
   * a secret (the security comes from Google's signature over the ID token, verified server-side).
   * Web build only, same reasoning as VITE_API_BASE_URL above. Set at build time in Vercel's project
   * settings; the matching Client ID must have the deployed site's origin listed under Authorized
   * JavaScript origins in Google Cloud Console, or the sign-in button will fail to load. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
