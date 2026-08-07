import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { OnboardingGate } from '../Onboarding/OnboardingGate';
import { AuthGate } from '../Auth/AuthGate';
import { AccountMenu } from '../Auth/AccountMenu';
import './AppShell.css';

export function AppShell() {
  return (
    // AuthGate wraps OnboardingGate, not the reverse: OnboardingGate's first call
    // (getOnboardingStatus) now needs a signed-in session to succeed at all, so auth has to resolve
    // first. On desktop AuthGate is a pure passthrough (see its own file) — this nesting costs
    // Electron nothing.
    <AuthGate>
      {/* Inside AuthGate (never shown pre-login) but outside OnboardingGate (stays visible and
          usable — in particular, Sign Out stays reachable — through the onboarding wizard, not
          just after it). One instance serves every route at both breakpoints; see AccountMenu.css
          for the fixed corner positioning that makes that possible without touching Sidebar or
          BottomNav. */}
      <AccountMenu />
      <OnboardingGate>
        <div className="app-shell">
          <Sidebar />
          <div className="app-shell__content">
            {/* The right pane's window-drag handle. titleBarStyle: 'hiddenInset' (main.ts) gives no
                draggable region on its own; the sidebar has its own strip, but the main pane needs
                this one to be movable too. Kept OUTSIDE the scrolling <main> so it never overlaps
                content or the sticky toolbars (which would swallow clicks / make pills undraggable).
                Mobile-hidden alongside the sidebar (see AppShell.css) — there's no Electron window
                to drag in a browser tab. */}
            <div className="app-shell__drag-bar" aria-hidden />
            <main className="app-shell__main">
              <Outlet />
            </main>
            {/* Rendered unconditionally — visibility is CSS-only (see AppShell.css's breakpoint), so
                there's no flash of the wrong nav while JS decides which one to show. */}
            <BottomNav />
          </div>
        </div>
      </OnboardingGate>
    </AuthGate>
  );
}
