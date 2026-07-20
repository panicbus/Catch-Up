import { useSettings } from '../../hooks/useSettings';
import './ThemeToggle.css';

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/** Shows the icon for the currently active theme; clicking swaps to the other. Sits at the bottom
 * of the sidebar. Only light/dark for now — no "system" option, matching AppSettings.theme. */
export function ThemeToggle() {
  const { settings, update } = useSettings();
  const isDark = settings.theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => update({ theme: isDark ? 'light' : 'dark' })}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className="theme-toggle__icon" key={settings.theme}>
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
}
