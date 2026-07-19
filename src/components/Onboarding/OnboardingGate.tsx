import type { ReactNode } from 'react';
import { useOnboardingGate } from '../../hooks/useOnboardingGate';
import { OnboardingWizard } from './OnboardingWizard';

interface OnboardingGateProps {
  children: ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { completed, markCompleted } = useOnboardingGate();

  if (completed === null) return null;
  if (!completed) return <OnboardingWizard onComplete={markCompleted} />;
  return <>{children}</>;
}
