import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { StreakCard } from './StreakCard';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { useChannels } from '../../hooks/useChannels';
import { useStreak } from '../../hooks/useStreak';
import { api } from '../../services/api';
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

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

export function Sidebar() {
  const { channels } = useChannels();
  const streak = useStreak();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar__link${isActive ? ' sidebar__link--active' : ''}`;

  const pendingDeleteChannel = channels.find((c) => c.id === pendingDeleteId);

  const confirmDelete = () => {
    if (!pendingDeleteChannel) return;
    void api.deleteChannel(pendingDeleteChannel.id);
    if (location.pathname === `/channel/${pendingDeleteChannel.id}`) navigate('/');
    setPendingDeleteId(null);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <Logo withWordmark size={52} />
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
      </nav>

      <div className="sidebar__channels">
        <div className="sidebar__section-label">Channels</div>
        {channels.map((channel) => (
          <div key={channel.id} className="sidebar__channel-row">
            <NavLink to={`/channel/${channel.id}`} className={navClass}>
              <span>{channel.name}</span>
            </NavLink>
            <button
              type="button"
              className="sidebar__channel-remove"
              aria-label={`Delete ${channel.name}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPendingDeleteId(channel.id);
              }}
            >
              <RemoveIcon />
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar__footer">
        <ThemeToggle />
        <span className="sidebar__version">v{__APP_VERSION__}</span>
      </div>

      {pendingDeleteChannel && (
        <Modal title={`Delete "${pendingDeleteChannel.name}"?`} onClose={() => setPendingDeleteId(null)}>
          <div className="modal__body">
            This removes the channel, its subchannels, its cached stories, and any bookmarks saved under it.
            This can't be undone.
          </div>
          <div className="modal__actions">
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete channel
            </Button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
