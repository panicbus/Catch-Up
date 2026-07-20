import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { StreakInfo } from '../../ipc-contract';

/** Streak only changes once per app launch, before any window exists to receive a push —
 * fetch-once on mount, no onDataChanged subscription (unlike channels/articles/bookmarks). */
export function useStreak() {
  const [streak, setStreak] = useState<StreakInfo | null>(null);

  useEffect(() => {
    void api.getStreak().then(setStreak);
  }, []);

  return streak;
}
