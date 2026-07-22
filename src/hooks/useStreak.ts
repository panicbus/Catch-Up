import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { StreakInfo } from '../../ipc-contract';

/** Streak can now advance mid-session (recordCatchUp fires when a channel hits "all caught up"
 * while the app is open, not just at launch) — fetch on mount and stay subscribed, matching the
 * pattern used by channels/articles/bookmarks. */
export function useStreak() {
  const [streak, setStreak] = useState<StreakInfo | null>(null);

  useEffect(() => {
    void api.getStreak().then(setStreak);
    return api.onDataChanged((event) => {
      if (event.type === 'streak') void api.getStreak().then(setStreak);
    });
  }, []);

  return streak;
}
