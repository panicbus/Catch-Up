import type { CatchUpApi } from '../ipc-contract';

declare global {
  interface Window {
    readonly api: CatchUpApi;
  }
}

export {};
