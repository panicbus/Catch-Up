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

/** Mobile-only — desktop reaches the brand mark and streak card through the sidebar, which is
 * hidden below 767px (see AppShell.css), so both need a mobile home for them. Used to also hold a
 * "Sign in" placeholder button; that's now the real AccountMenu (src/components/Auth/AccountMenu.tsx),
 * rendered once by AppShell as shared chrome on every route rather than Home-only, so it was removed
 * from here rather than left as a second, competing affordance. */
function MobileTopBar() {
  return (
    <div className="home-page__mobile-topbar">
      <Logo withWordmark wordmarkLayout="inline" size={34} />
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
