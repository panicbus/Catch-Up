import { useCurrentUser } from '../../hooks/useCurrentUser';
import { logout } from '../../services/auth';
import { Button } from '../common/Button';
import './AccountSection.css';

// Same guard AccountMenu.tsx uses — desktop has no auth store to read from at all.
const isWeb = typeof window !== 'undefined' && !window.api;

/** Settings' own sign-out affordance — the counterpart to AccountMenu.tsx's corner dropdown, which
 * moved to Home-only chrome and no longer covers every route (see AppShell.tsx and HomePage.tsx).
 * Renders its own `settings-section` wrapper (rather than SettingsPage.tsx providing one, as it does
 * for every other section) so it can render nothing at all — heading included — on desktop or before
 * a user is loaded, instead of leaving an orphan "Account" heading over an empty section. */
export function AccountSection() {
  const user = useCurrentUser();
  if (!isWeb || !user) return null;

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Account</h2>
      <div className="account-section">
        <div className="account-section__identity">
          {user.avatarUrl ? (
            <img className="account-section__avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="account-section__avatar account-section__avatar--fallback">
              {(user.displayName ?? user.email).charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            {user.displayName && <div className="account-section__name">{user.displayName}</div>}
            <div className="account-section__email">{user.email}</div>
          </div>
        </div>
        <Button variant="danger" size="sm" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </section>
  );
}
