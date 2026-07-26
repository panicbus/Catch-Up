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
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.completeOnboarding(names);
      onComplete();
    } catch (e) {
      setSubmitting(false);
      setError('Something went wrong setting up your channels — try again.');
      console.error('[OnboardingWizard] completeOnboarding failed', e);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <div className="onboarding__header">
          <Logo size={88} />
          <h1 className="onboarding__title">Welcome to Catch Up</h1>
          <p className="onboarding__tagline">Your news. Your pace. All caught up.</p>
        </div>

        <p className="onboarding__prompt">Pick a few topics to start. Anything goes!</p>
        <OnboardingChannelPicker names={names} onChange={setNames} />

        <div className="onboarding__footer">
          <Button variant="success" disabled={names.length === 0 || submitting} onClick={handleContinue}>
            {submitting ? 'Setting up…' : 'Continue'}
          </Button>
          {error && <p className="onboarding__error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
