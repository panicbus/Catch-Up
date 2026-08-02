import { NavLink } from 'react-router-dom';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { StreakCard } from './StreakCard';
import { useChannels } from '../../hooks/useChannels';
import { useStreak } from '../../hooks/useStreak';
import './Sidebar.css';

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11l9-8 9 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PoolIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.6 1z" />
    </svg>
  );
}

function AboutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Sidebar() {
  const { channels } = useChannels();
  const streak = useStreak();
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar__link${isActive ? ' sidebar__link--active' : ''}`;

  return (
    <aside className="sidebar">
      {/* Electron's titleBarStyle: 'hiddenInset' (main.ts) hides the native title bar but doesn't
          make anything draggable on its own — without an explicit -webkit-app-region: drag
          region somewhere, there's no way to move the window at all. This sits exactly in the
          sidebar's existing reserved top clearance (see .sidebar's padding-top, sized for the
          traffic-light buttons), which is otherwise empty space, so it can't overlap anything
          interactive. */}
      <div className="sidebar__drag-region" />
      <div className="sidebar__brand">
        <NavLink to="/" className="sidebar__brand-link" aria-label="Go to home">
          <Logo withWordmark size={52} />
        </NavLink>
        <p className="sidebar__tagline">Your news. Your pace. All caught up.</p>
        {streak && streak.current > 0 && <StreakCard current={streak.current} />}
      </div>

      <nav className="sidebar__nav">
        <NavLink to="/" end className={navClass}>
          <HomeIcon />
          <span>Home</span>
        </NavLink>
        <NavLink to="/pool" className={navClass}>
          <PoolIcon />
          <span>The Pool</span>
        </NavLink>
        <NavLink to="/bookmarks" className={navClass}>
          <BookmarkIcon />
          <span>Bookmarks</span>
        </NavLink>
        <NavLink to="/settings" className={navClass}>
          <SettingsIcon />
          <span>Settings</span>
        </NavLink>
        <NavLink to="/about" className={navClass}>
          <AboutIcon />
          <span>About</span>
        </NavLink>
      </nav>

      <div className="sidebar__channels-section">
        <div className="sidebar__section-label">Channels</div>
        <div className="sidebar__channels">
          {channels.map((channel) => (
            <NavLink key={channel.id} to={`/channel/${channel.id}`} className={navClass}>
              <span>{channel.name}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <div className="sidebar__footer">
        <ThemeToggle />
        <span className="sidebar__version">v{__APP_VERSION__}</span>
      </div>
    </aside>
  );
}
