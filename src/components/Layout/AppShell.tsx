import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
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
              content or the sticky toolbars (which would swallow clicks / make pills undraggable).
              Mobile-hidden alongside the sidebar (see AppShell.css) — there's no Electron window to
              drag in a browser tab. */}
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
  );
}
