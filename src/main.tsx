import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles/global.css';

// The desktop build talks to its own local bridge (window.api); the web build talks to the hosted
// backend over HTTP. A few things below are web-only for that reason.
const isWeb = typeof window !== 'undefined' && !window.api;

// Service worker: web build only — the packaged Electron app never makes HTTP requests to itself,
// so a service worker would have nothing to do. This exists purely for installability (Add to Home
// Screen) and fast repeat asset loads, not offline data — see vite.config.ts's workbox comment.
// autoUpdate + immediate registration means a new deploy replaces the cached shell on next load
// rather than pinning a stale one indefinitely.
if (isWeb) {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      // registerSW() only checks for a new service worker once, at this page load — it never
      // checks again on its own. That's invisible on desktop (a browser tab gets reloaded/revisited
      // often) but real on a phone: a home-screen PWA resumed from the app switcher, or a Safari tab
      // left open in the background, is the SAME page load from days ago and never re-registers, so
      // it can sit on a stale bundle indefinitely even though a new one has long since deployed.
      // Confirmed live — some phones kept showing an old build days after a deploy while others
      // (freshly opened) had it immediately. Re-checking whenever the tab/app comes back to the
      // foreground is the standard fix: it's the moment a user would actually expect to see new
      // content, and it reliably fires even when background timers don't (iOS suspends those).
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });
}

// The web build used to be wrapped in a shared-password gate here. Removed 2026-08-05 — it was
// friction for a single-owner site and offered little real protection (the API address is
// discoverable), and its brute-force limiter locked the owner out during an unrelated outage.
// Google sign-in is the planned replacement; see server/index.ts for the full note.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
