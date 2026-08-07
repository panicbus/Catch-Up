import { useEffect, useState, type ReactNode } from 'react';
import { useOnboardingGate } from '../../hooks/useOnboardingGate';
import { OnboardingWizard } from './OnboardingWizard';
import { Logo } from '../Layout/Logo';
import './OnboardingGate.css';

interface OnboardingGateProps {
  children: ReactNode;
}

// The desktop build's bridge is local and instant; only the web build talks to the hosted backend
// over a real network call, so only it can hit the cold-start wait below.
const isWeb = typeof window !== 'undefined' && !window.api;

// getOnboardingStatus (useOnboardingGate, below) is the very first network call the app makes, and
// while `completed` is still null this gate is rendering nothing — normally invisible (that call
// resolves in well under a second), but Render's free-tier backend fully suspends after ~15 minutes
// idle, and the first request after that has to cold-boot the server, commonly taking 20-30+
// seconds. Delaying the notice means a warm backend's ordinary fast load never flashes it — it only
// appears once a wait is actually long enough to plausibly be a cold start.
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
    return showColdStartNotice ? (
      <div className="onboarding-gate__cold-start" role="status">
        <div className="onboarding-gate__cold-start-spinner">
          <Logo size={64} />
        </div>
        <p>Waking up the server. This can take up to 30 seconds on the first load.</p>
      </div>
    ) : null;
  }
  if (!completed) return <OnboardingWizard onComplete={markCompleted} />;
  return <>{children}</>;
}
