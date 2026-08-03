import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { PasswordGate } from './components/PasswordGate';
import './styles/global.css';

// Only the web build needs the shared-password gate — the desktop build talks to its own local
// bridge (window.api), never the internet-reachable hosted backend, so there's nothing to lock.
const isWeb = typeof window !== 'undefined' && !window.api;

// Service worker: web build only, same reasoning as the password gate above — the packaged
// Electron app never makes HTTP requests to itself, so a service worker would have nothing to do.
// This exists purely for installability (Add to Home Screen) and fast repeat asset loads, not
// offline data — see vite.config.ts's workbox comment. autoUpdate + immediate registration means a
// new deploy replaces the cached shell on next load rather than pinning a stale one indefinitely.
if (isWeb) registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isWeb ? (
      <PasswordGate>
        <App />
      </PasswordGate>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
