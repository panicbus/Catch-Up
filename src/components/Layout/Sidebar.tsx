import { NavLink } from 'react-router-dom';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { StreakCard } from './StreakCard';
import { HomeIcon, PoolIcon, BookmarkIcon, SettingsIcon } from './NavIcons';
import { AppInfoButton } from '../common/AppInfoButton';
import { useChannels } from '../../hooks/useChannels';
import { useStreak } from '../../hooks/useStreak';
import './Sidebar.css';

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
        <div className="sidebar__brand-row">
          <NavLink to="/" className="sidebar__brand-link" aria-label="Go to home">
            <Logo withWordmark size={52} />
          </NavLink>
          <AppInfoButton />
        </div>
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
            <NavLink key={channel.id} to={`/channel/${channel.slug}`} className={navClass}>
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
