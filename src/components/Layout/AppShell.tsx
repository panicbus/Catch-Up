import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { OnboardingGate } from '../Onboarding/OnboardingGate';
import './AppShell.css';

export function AppShell() {
  return (
    <OnboardingGate>
      <div className="app-shell">
        <Sidebar />
        <main className="app-shell__main">
          <Outlet />
        </main>
      </div>
    </OnboardingGate>
  );
}
