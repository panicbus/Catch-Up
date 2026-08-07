import { useEffect, useState, type ReactNode } from 'react';
import { useOnboardingGate } from '../../hooks/useOnboardingGate';
import { OnboardingWizard } from './OnboardingWizard';
import { ColdStartNotice } from '../common/ColdStartNotice';

interface OnboardingGateProps {
  children: ReactNode;
}

// The desktop build's bridge is local and instant; only the web build talks to the hosted backend
// over a real network call, so only it can hit the cold-start wait below.
const isWeb = typeof window !== 'undefined' && !window.api;

// getOnboardingStatus (useOnboardingGate, below) is the very first network call the app makes ON
// DESKTOP. On web it's actually the second — AuthGate's getMe() (src/components/Auth/AuthGate.tsx)
// now runs first and gates this component entirely, so a signed-out or still-loading web visitor
// never reaches this hook at all. This delayed-notice mechanism stays here for onboarding's own
// call, and desktop still needs it (no AuthGate there — the whole concept of a session is web-only).
const COLD_START_NOTICE_DELAY_MS = 2500;

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { completed, markCompleted } = useOnboardingGate();
  const [showColdStartNotice, setShowColdStartNotice] = useState(false);

  useEffect(() => {
    if (completed !== null || !isWeb) return;
    const timer = window.setTimeout(() => setShowColdStartNotice(true), COLD_START_NOTICE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [completed]);

  if (completed === null) {
    return showColdStartNotice ? <ColdStartNotice /> : null;
  }
  if (!completed) return <OnboardingWizard onComplete={markCompleted} />;
  return <>{children}</>;
}
