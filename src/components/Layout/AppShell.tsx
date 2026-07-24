import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { OnboardingGate } from '../Onboarding/OnboardingGate';
import './AppShell.css';

export function AppShell() {
  return (
    <OnboardingGate>
      <div className="app-shell">
        <Sidebar />
        <div className="app-shell__content">
          {/* The right pane's window-drag handle. titleBarStyle: 'hiddenInset' (main.ts) gives no
              draggable region on its own; the sidebar has its own strip, but the main pane needs
              this one to be movable too. Kept OUTSIDE the scrolling <main> so it never overlaps
              content or the sticky toolbars (which would swallow clicks / make pills undraggable). */}
          <div className="app-shell__drag-bar" aria-hidden />
          <main className="app-shell__main">
            <Outlet />
          </main>
        </div>
      </div>
    </OnboardingGate>
  );
}
