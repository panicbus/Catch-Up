import { useSyncExternalStore } from 'react';
import * as auth from '../services/auth';

/** Thin subscriber over src/services/auth.ts's shared store — see channelsStore.ts/useChannels.ts
 * for the identical pattern. useSyncExternalStore (not useState+useEffect) so a warm cache (e.g.
 * AccountMenu and AuthGate both reading this in the same commit) can't tear between subscribers.
 * Not wired to api.ts's onDataChanged: there's no 'auth' DataChangeEvent variant, and adding one
 * would force ipc-contract.ts/preload.ts to know about a web-only concept (see AuthGate.tsx's file
 * comment) — this is driven entirely by auth.ts's own notify() calls (login/logout/getMe/401). */
export function useCurrentUser() {
  return useSyncExternalStore(auth.subscribe, auth.getSnapshot);
}
