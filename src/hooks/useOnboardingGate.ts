import { useEffect, useState } from 'react';
import { api } from '../services/api';

export function useOnboardingGate() {
  const [completed, setCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    void api.getOnboardingStatus().then((status) => setCompleted(status.completed));
  }, []);

  const markCompleted = () => setCompleted(true);

  return { completed, markCompleted };
}
