import { NavLink } from 'react-router-dom';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { useChannels } from '../../hooks/useChannels';
import { useStreak } from '../../hooks/useStreak';
import './Sidebar.css';

function FlameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2c1 4-4 5-4 10a4 4 0 0 0 8 0c1.5 1 2 2.5 2 4a6 6 0 0 1-12 0c0-5 3-6 4-10 0 2 1 3 2 3-1-3 0-5 0-7z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11l9-8 9 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
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

export function Sidebar() {
  const { channels } = useChannels();
  const streak = useStreak();
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar__link${isActive ? ' sidebar__link--active' : ''}`;

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <Logo withWordmark size={26} />
        <p className="sidebar__tagline">Your topics. Your pace. All caught up.</p>
        {streak && streak.current > 0 && (
          <div className="sidebar__streak" key={streak.current}>
            <FlameIcon />
            <span>{streak.current}-day streak</span>
          </div>
        )}
      </div>

      <nav className="sidebar__nav">
        <NavLink to="/" end className={navClass}>
          <HomeIcon />
          <span>Home</span>
        </NavLink>
        <NavLink to="/bookmarks" className={navClass}>
          <BookmarkIcon />
          <span>Bookmarks</span>
        </NavLink>
        <NavLink to="/settings" className={navClass}>
          <SettingsIcon />
          <span>Settings</span>
        </NavLink>
      </nav>

      <div className="sidebar__channels">
        <div className="sidebar__section-label">Channels</div>
        {channels.map((channel) => (
          <NavLink key={channel.id} to={`/channel/${channel.id}`} className={navClass}>
            <span>{channel.name}</span>
          </NavLink>
        ))}
      </div>

      <div className="sidebar__footer">
        <ThemeToggle />
        <span className="sidebar__version">v{__APP_VERSION__}</span>
      </div>
    </aside>
  );
}
