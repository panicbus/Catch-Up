import { useState, useEffect } from 'react';

const BREAKPOINT_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(BREAKPOINT_QUERY).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(BREAKPOINT_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
