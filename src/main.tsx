import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PasswordGate } from './components/PasswordGate';
import './styles/global.css';

// Only the web build needs the shared-password gate — the desktop build talks to its own local
// bridge (window.api), never the internet-reachable hosted backend, so there's nothing to lock.
const isWeb = typeof window !== 'undefined' && !window.api;

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
