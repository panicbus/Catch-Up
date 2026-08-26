import { useRef, useState, type KeyboardEvent } from 'react';
import { Logo } from '../Layout/Logo';
import { OnboardingChannelPicker } from './OnboardingChannelPicker';
import { Button } from '../common/Button';
import { api } from '../../services/api';
import { useSettings } from '../../hooks/useSettings';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useAiConfig } from '../../hooks/useAiConfig';
import { EMAIL_PATTERN } from '../../utils/email';
import dinerBg from '../../assets/diner-bg.png';
import './OnboardingWizard.css';

interface OnboardingWizardProps {
  onComplete: () => void;
}

// The digest is a web-only feature (a scheduled job against the hosted database — see
// server/cron/digest.ts) with nothing for it to do on a desktop-only account, same guard every
// other web-only settings section uses (DigestSetting.tsx, CustomSourcesSetting.tsx).
const isWeb = typeof window !== 'undefined' && !window.api;

type Step = 'topics' | 'location' | 'email';
type LocationStatus = 'idle' | 'checking' | 'not-found';
type ResolvedHomeLocation = { query: string; label: string; lat: number; lon: number; countryCode: string };

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

  // Third (web-only) step: the digest email — see DigestSetting.tsx's own comment on why this is now
  // required for the digest to ever send at all, rather than an optional override. AuthGate has
  // already resolved the signed-in user by the time this component can even mount (it wraps
  // OnboardingGate), so this is safe to read directly rather than needing a settle-on-load effect —
  // unlike useSettings, there's no separate fetch here still in flight.
  const currentUser = useCurrentUser();
  const [emailText, setEmailText] = useState(() => currentUser?.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  // Carries the location step's result forward to the email step, which is the one that actually
  // calls finish(). A real ref (not component-body state) since setStep('email') below re-renders
  // this component well before finish() is ever actually called with it.
  const pendingLocationRef = useRef<ResolvedHomeLocation | undefined>(undefined);
  // Same "turn on AI filtering automatically if it isn't already" behavior DigestSetting.tsx's own
  // enable() has — the recap needs AI configured to write anything, and this is the other place the
  // digest gets turned on, so it needs the same behavior or an onboarding-opted-in digest silently
  // arrives every day with no recap, just the bare story list.
  const { config: aiConfig, setProvider } = useAiConfig();

  // `homeLocation` is optional: leaving the field blank (or hitting Skip) still completes onboarding
  // normally, exactly like leaving it blank in Settings does today — this is a nice-to-have, not a
  // gate on getting into the app. Same for `digestEmail`: providing one here both saves it AND turns
  // the digest on outright (with sensible defaults — every just-created channel, and the device's own
  // time zone) — skipping just leaves the digest off, exactly like never having visited Settings.
  //
  // Both settings updates are awaited (and their failure caught below) rather than fired-and-
  // forgotten: onComplete() lets the user straight into the app either way, so an unnoticed failure
  // here would mean they believe their location/digest is saved when the server never actually got
  // it, with nothing telling them otherwise short of happening to check Settings later.
  const finish = async (homeLocation?: ResolvedHomeLocation, digestEmail?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const channels = await api.completeOnboarding(names);
      if (homeLocation) await update({ homeLocation });
      if (digestEmail) {
        if (aiConfig.provider === null) setProvider('gemini');
        await update({
          digestEnabled: true,
          // Omitted when a home location was ALSO just set above: that update's own server-side
          // logic (dataStore.ts's setSettings) derives a time zone from the home city instead, a
          // better default for a digest than "wherever this device happens to be" — explicitly
          // setting it here too would just overwrite that derivation outright, regardless of the
          // await above, since it's still a second, separate request. No home location means there's
          // nothing to derive from, so the device's own zone is still the right fallback in that
          // case, same as DigestSetting.tsx's own enable().
          ...(!homeLocation && { digestTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
          digestChannelIds: channels.map((c) => c.id),
          digestEmailOverride: digestEmail,
        });
      }
      onComplete();
    } catch (e) {
      setSubmitting(false);
      setError('Something went wrong finishing setup. Try again.');
      console.error('[OnboardingWizard] finish failed', e);
    }
  };

  const handleLocationContinue = async () => {
    const query = locationText.trim();
    if (!query) {
      advanceFromLocation();
      return;
    }
    setLocationStatus('checking');
    const resolved = await api.resolveHomeLocation(query);
    if (!resolved) {
      setLocationStatus('not-found');
      return;
    }
    advanceFromLocation({ query, ...resolved });
  };

  // Shared by both the location step's Skip and Continue paths. On web, carries the location
  // forward to the email step, which is the one that actually calls finish(). Desktop has no
  // digest to offer, so this is the final step there: call finish() directly.
  const advanceFromLocation = (homeLocation?: ResolvedHomeLocation) => {
    if (isWeb) {
      pendingLocationRef.current = homeLocation;
      setStep('email');
    } else {
      void finish(homeLocation);
    }
  };

  const onLocationKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleLocationContinue();
  };

  const handleEmailContinue = () => {
    const trimmed = emailText.trim();
    if (trimmed && !EMAIL_PATTERN.test(trimmed)) {
      setEmailError("That doesn't look like a valid email address.");
      return;
    }
    void finish(pendingLocationRef.current, trimmed || undefined);
  };

  const onEmailKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleEmailContinue();
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

        {step === 'topics' && (
          <>
            <p className="onboarding__prompt">Add three topics that interest you.</p>
            <OnboardingChannelPicker names={names} onChange={setNames} />
            <div className="onboarding__footer">
              <Button variant="success" disabled={names.length === 0} onClick={() => setStep('location')}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 'location' && (
          <>
            <p className="onboarding__prompt">Add your city (state) and country.</p>
            <p className="onboarding__hint">
              This is used to filter out local stories from places you don’t follow. You can change
              or clear it anytime in Settings.
            </p>
            <input
              className="onboarding__text-input onboarding__text-input--spaced"
              type="text"
              placeholder="e.g. Alameda, CA"
              value={locationText}
              onChange={(e) => {
                setLocationText(e.target.value);
                if (locationStatus === 'not-found') setLocationStatus('idle');
              }}
              onKeyDown={onLocationKeyDown}
              spellCheck={false}
              autoFocus
            />
            {locationStatus === 'not-found' && (
              <p className="onboarding__error">City not found. Try “City, State” or “City, Country”.</p>
            )}
            <div className="onboarding__footer">
              <Button variant="ghost" disabled={submitting} onClick={() => advanceFromLocation()}>
                Skip for now
              </Button>
              <Button
                variant="success"
                disabled={submitting || locationStatus === 'checking'}
                onClick={() => void handleLocationContinue()}
              >
                {locationStatus === 'checking' ? 'Checking…' : submitting ? 'Setting up…' : 'Continue'}
              </Button>
            </div>
          </>
        )}

        {step === 'email' && (
          <>
            <p className="onboarding__prompt">Get a daily digest email?</p>
            <p className="onboarding__hint">
              A short written recap plus your top stories, once a day. Leave this blank to skip it.
              You can turn it on anytime in Settings.
            </p>
            <input
              className="onboarding__text-input onboarding__text-input--spaced"
              type="email"
              placeholder="you@example.com"
              value={emailText}
              onChange={(e) => {
                setEmailText(e.target.value);
                if (emailError) setEmailError(null);
              }}
              onKeyDown={onEmailKeyDown}
              spellCheck={false}
              autoFocus
            />
            {emailError && <p className="onboarding__error">{emailError}</p>}
            <div className="onboarding__footer">
              <Button variant="ghost" disabled={submitting} onClick={() => void finish(pendingLocationRef.current)}>
                Skip for now
              </Button>
              <Button variant="success" disabled={submitting} onClick={handleEmailContinue}>
                {submitting ? 'Setting up…' : 'Continue'}
              </Button>
            </div>
          </>
        )}

        {error && <p className="onboarding__error">{error}</p>}
      </div>
    </div>
  );
}
