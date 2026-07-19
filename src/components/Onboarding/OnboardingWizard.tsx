import { useState } from 'react';
import { Logo } from '../Layout/Logo';
import { OnboardingChannelPicker } from './OnboardingChannelPicker';
import { Button } from '../common/Button';
import { api } from '../../services/api';
import './OnboardingWizard.css';

interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [names, setNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleContinue = async () => {
    setSubmitting(true);
    await api.completeOnboarding(names);
    onComplete();
  };

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <div className="onboarding__header">
          <Logo size={44} />
          <h1 className="onboarding__title">Welcome to Catch Up</h1>
          <p className="onboarding__tagline">Your topics. Your pace. All caught up.</p>
        </div>

        <p className="onboarding__prompt">Pick a few topics to follow — anything goes.</p>
        <OnboardingChannelPicker names={names} onChange={setNames} />

        <div className="onboarding__footer">
          <Button variant="primary" disabled={names.length === 0 || submitting} onClick={handleContinue}>
            {submitting ? 'Setting up…' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}
