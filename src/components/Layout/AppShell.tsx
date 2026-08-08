import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { OnboardingGate } from '../Onboarding/OnboardingGate';
import { AuthGate } from '../Auth/AuthGate';
import './AppShell.css';

export function AppShell() {
  return (
    // AuthGate wraps OnboardingGate, not the reverse: OnboardingGate's first call
    // (getOnboardingStatus) now needs a signed-in session to succeed at all, so auth has to resolve
    // first. On desktop AuthGate is a pure passthrough (see its own file) — this nesting costs
    // Electron nothing.
    //
    // AccountMenu is NOT rendered here — it used to be global fixed-position chrome on every route,
    // but now lives inline in HomePage's own header row (see HomePage.tsx), scrolling out of view
    // with the rest of Home's content instead of floating over every page. Sign out is reachable
    // from Settings instead (AccountSection.tsx) for every OTHER route. The one gap this reopens:
    // there's no sign-out affordance while OnboardingWizard is showing (before Home or Settings is
    // reachable at all) — accepted, matches what was asked for.
    <AuthGate>
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
