import type { CatchUpApi } from '../ipc-contract';

declare global {
  interface Window {
    // Optional, not always present: only the desktop build's preload script injects this — the
    // web build has no such bridge and talks to the hosted backend over fetch() instead (see
    // src/services/api.ts).
    readonly api?: CatchUpApi;
  }
}

export {};
