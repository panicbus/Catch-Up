import { useState, type KeyboardEvent } from 'react';
import { Logo } from '../Layout/Logo';
import { OnboardingChannelPicker } from './OnboardingChannelPicker';
import { Button } from '../common/Button';
import { api } from '../../services/api';
import { useSettings } from '../../hooks/useSettings';
import dinerBg from '../../assets/diner-bg.png';
import './OnboardingWizard.css';

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = 'topics' | 'location';
type LocationStatus = 'idle' | 'checking' | 'not-found';

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('topics');
  const [names, setNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Second step: home location, right after topics — see LocationSetting.tsx (Settings) for the
  // identical resolve-and-save pattern this reuses; asking here too means filtering starts working
  // from day one instead of only once someone happens to find it in Settings later.
  const { update } = useSettings();
  const [locationText, setLocationText] = useState('');
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');

  // `homeLocation` is optional: leaving the field blank (or hitting Skip) still completes onboarding
  // normally, exactly like leaving it blank in Settings does today — this is a nice-to-have, not a
  // gate on getting into the app.
  const finish = async (homeLocation?: { query: string; label: string; lat: number; lon: number; countryCode: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await api.completeOnboarding(names);
      if (homeLocation) update({ homeLocation });
      onComplete();
    } catch (e) {
      setSubmitting(false);
      setError('Something went wrong setting up your channels — try again.');
      console.error('[OnboardingWizard] completeOnboarding failed', e);
    }
  };

  const handleLocationContinue = async () => {
    const query = locationText.trim();
    if (!query) {
      void finish();
      return;
    }
    setLocationStatus('checking');
    const resolved = await api.resolveHomeLocation(query);
    if (!resolved) {
      setLocationStatus('not-found');
      return;
    }
    void finish({ query, ...resolved });
  };

  const onLocationKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleLocationContinue();
  };

  return (
    <div className="onboarding">
      {/* Diner sketch embedded into the cream via multiply (shared with Home). */}
      <div className="onboarding__bg" style={{ backgroundImage: `url("${dinerBg}")` }} aria-hidden="true" />
      <div className="onboarding__card">
        <div className="onboarding__header">
          <Logo size={88} />
          <h1 className="onboarding__title">Welcome to Catch Up</h1>
          <p className="onboarding__tagline">Your news. Your pace. All caught up.</p>
        </div>

        {step === 'topics' ? (
          <>
            <p className="onboarding__prompt">Add three topics that interest you.</p>
            <OnboardingChannelPicker names={names} onChange={setNames} />
            <div className="onboarding__footer">
              <Button variant="success" disabled={names.length === 0} onClick={() => setStep('location')}>
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="onboarding__prompt">Add your city (state) and country.</p>
            <p className="onboarding__hint">
              This is used to filter out local stories from places you don’t follow — you can change
              or clear it anytime in Settings.
            </p>
            <input
              className="onboarding__location-input"
              type="text"
              placeholder="e.g. Alameda, CA"
              value={locationText}
              onChange={(e) => {
                setLocationText(e.target.value);
                if (locationStatus === 'not-found') setLocationStatus('idle');
              }}
              onKeyDown={onLocationKeyDown}
              disabled={submitting}
              spellCheck={false}
              autoFocus
            />
            {locationStatus === 'not-found' && (
              <p className="onboarding__error">City not found — try “City, State” or “City, Country”.</p>
            )}
            <div className="onboarding__footer">
              <Button variant="ghost" disabled={submitting} onClick={() => void finish()}>
                Skip for now
              </Button>
              <Button
                variant="success"
                disabled={submitting || locationStatus === 'checking'}
                onClick={() => void handleLocationContinue()}
              >
                {submitting ? 'Setting up…' : locationStatus === 'checking' ? 'Checking…' : 'Continue'}
              </Button>
            </div>
            {error && <p className="onboarding__error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
