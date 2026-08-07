import { Logo } from '../Layout/Logo';
import './ColdStartNotice.css';

/** Shown while a gate (OnboardingGate, AuthGate) is waiting on the FIRST network call of the
 * session — the one that can actually hit Render's free-tier cold start (fully suspends after ~15
 * minutes idle; the next request then takes 20-30+ seconds to boot the server back up). Extracted
 * from OnboardingGate, which had this before AuthGate needed the identical thing in front of it. */
export function ColdStartNotice() {
  return (
    <div className="cold-start-notice" role="status">
      <div className="cold-start-notice__spinner">
        <Logo size={64} />
      </div>
      <p>Waking up the server. This can take up to 30 seconds on the first load.</p>
    </div>
  );
}
