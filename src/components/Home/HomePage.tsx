import { useState } from 'react';
import { useChannels } from '../../hooks/useChannels';
import { useChannelCounts } from '../../hooks/useChannelCounts';
import { useStreak } from '../../hooks/useStreak';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ChannelSearchBar } from './ChannelSearchBar';
import { ChannelTabGrid } from './ChannelTabGrid';
import { RollTheDiceButton } from './RollTheDiceButton';
import { EmptyState } from '../common/EmptyState';
import { Logo } from '../Layout/Logo';
import { StreakCard } from '../Layout/StreakCard';
import dinerBg from '../../assets/diner-bg.png';
import './HomePage.css';

function PersonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

/** Mobile-only — desktop reaches the brand mark and streak card through the sidebar, which is
 * hidden below 767px (see AppShell.css), so both need a mobile home for them. There's no account
 * system yet (the site has no auth at all right now — see server/index.ts), so "Sign in" is a
 * placeholder for the future per-user auth phase — it renders as designed but only ever shows a
 * short note that accounts are coming, never a real sign-in flow. */
function MobileTopBar() {
  const [noteVisible, setNoteVisible] = useState(false);

  const showNote = () => {
    setNoteVisible(true);
    window.setTimeout(() => setNoteVisible(false), 3000);
  };

  return (
    <div className="home-page__mobile-topbar">
      <div className="home-page__mobile-topbar-row">
        <Logo withWordmark wordmarkLayout="inline" size={34} />
        <button type="button" className="home-page__sign-in" onClick={showNote}>
          <PersonIcon />
          Sign in
        </button>
      </div>
      {noteVisible && <p className="home-page__sign-in-note">Accounts are coming soon.</p>}
    </div>
  );
}

export function HomePage() {
  const { channels, loading } = useChannels();
  const { counts, totalUnread } = useChannelCounts(channels);
  const streak = useStreak();
  const isMobile = useIsMobile();

  return (
    <div className="home-page">
      {/* Diner sketch embedded into the cream via multiply (white → cream, lines show through). */}
      <div className="home-page__bg" style={{ backgroundImage: `url("${dinerBg}")` }} aria-hidden="true" />

      {isMobile && <MobileTopBar />}

      <div className="home-page__utility-bar">
        <ChannelSearchBar />
      </div>

      {/* Desktop shows this in the sidebar; mobile has no sidebar, so it needs its own copy here.
          Only one of the two is ever mounted at a time. */}
      {isMobile && streak && streak.current > 0 && (
        <div className="home-page__mobile-streak">
          <StreakCard current={streak.current} />
        </div>
      )}

      {!loading && channels.length === 0 ? (
        <EmptyState
          title="No channels yet"
          body="Search for a topic above to create your first channel."
        />
      ) : (
        <>
          <div className="home-page__heading">
            <div className="home-page__heading-title">Your channels</div>
            <div className="home-page__heading-subtitle">
              {loading
                ? ' ' // Reserves the line's height without asserting "0 channels" while still loading — that's not
                  // just wrong, it's a claim: it's asserting a real answer to "how many do I have" before there is one.
                : `${channels.length} channel${channels.length === 1 ? '' : 's'} · ${totalUnread} stor${totalUnread === 1 ? 'y' : 'ies'} to catch up on`}
            </div>
          </div>
          <div className="home-page__dice-row">
            <RollTheDiceButton />
            <span className="home-page__dice-caption">Pull a random unread story from your pool</span>
          </div>
          <ChannelTabGrid channels={channels} counts={counts} />
        </>
      )}
    </div>
  );
}
