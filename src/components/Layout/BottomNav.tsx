import { NavLink } from 'react-router-dom';
import { HomeIcon, PoolIcon, BookmarkIcon, SettingsIcon } from './NavIcons';
import './BottomNav.css';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `bottom-nav__link${isActive ? ' bottom-nav__link--active' : ''}`;

/** Mobile replacement for the sidebar's nav section — CSS-only visibility (hidden above 767px, see
 * BottomNav.css), rendered unconditionally by AppShell rather than gated in JS so there's no flash
 * of the wrong nav on first paint. No About tab and no channels list: About is dropped on mobile
 * (see Sidebar's now-mobile-only footer items), and channels are reached via Home's tile grid
 * instead of a persistent list, matching the mockup's four-tab bar. */
export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <NavLink to="/" end className={navClass}>
        <HomeIcon />
        <span>Home</span>
      </NavLink>
      <NavLink to="/pool" className={navClass}>
        <PoolIcon />
        <span>The Pool</span>
      </NavLink>
      <NavLink to="/bookmarks" className={navClass}>
        {({ isActive }) => (
          <>
            <BookmarkIcon filled={isActive} />
            <span>Bookmarks</span>
          </>
        )}
      </NavLink>
      <NavLink to="/settings" className={navClass}>
        {({ isActive }) => (
          <>
            <SettingsIcon filled={isActive} />
            <span>Settings</span>
          </>
        )}
      </NavLink>
    </nav>
  );
}
