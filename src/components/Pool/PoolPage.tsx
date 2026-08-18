import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChannels } from '../../hooks/useChannels';
import { usePoolArticles } from '../../hooks/usePoolArticles';
import { useSettings } from '../../hooks/useSettings';
import { useTrustedSourceToggle } from '../../hooks/useTrustedSourceToggle';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ViewModeToggle } from '../Channel/ViewModeToggle';
import { NewsFeed } from '../Channel/NewsFeed';
import { FeedSkeleton } from '../Channel/FeedSkeleton';
import { EmptyState } from '../common/EmptyState';
import '../Channel/SubchannelBar.css';
import './PoolPage.css';

const SHOWN_OPTIONS = [10, 25, 50] as const;

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Every channel's stories merged into one chronological feed — filterable down to a single
 * channel, but never a subchannel (that's what keeps this "a pool," not just another channel
 * view). The count pill caps the TOTAL number of recent stories shown (showReadDimmed): read
 * stories stay in place, dimmed, rather than dropping out, so "10 / 25 / 50" visibly controls how
 * much of the pool you see. Still gets catch-up behavior — scrolling past or opening a story marks
 * it read, and once the shown set is all read the celebration fires and the streak bumps. On
 * mobile, a swipe (or the checkmark, which is really just a keyboard/desktop-friendly equivalent
 * of the same gesture) marks the story read and removes it from view — there's no archive here to
 * file it into, but the read state is real and shared, so it settles into the story's OWN channel's
 * archive the next time that channel is visited. Unbookmarking, unlike on Bookmarks, does NOT
 * remove a card here — this is a general feed, not a bookmarks-only one. */
export function PoolPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { channels } = useChannels();
  const { articles, loading } = usePoolArticles(channels);
  const { settings, update } = useSettings();
  const { trustedSourceDomains, onToggleTrust } = useTrustedSourceToggle(settings, update);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState<(typeof SHOWN_OPTIONS)[number]>(25);
  const [channelsOpen, setChannelsOpen] = useState(false);

  const filtered = activeChannelId ? articles.filter((a) => a.channelId === activeChannelId) : articles;
  const activeChannelName = activeChannelId ? channels.find((c) => c.id === activeChannelId)?.name : null;

  const channelPills = (
    <>
      <button
        type="button"
        className={`subchannel-bar__chip ${activeChannelId === null ? 'subchannel-bar__chip--active' : ''}`}
        onClick={() => {
          setActiveChannelId(null);
          setChannelsOpen(false);
        }}
      >
        All
      </button>
      {channels.map((channel) => (
        <button
          key={channel.id}
          type="button"
          className={`subchannel-bar__chip ${activeChannelId === channel.id ? 'subchannel-bar__chip--active' : ''}`}
          onClick={() => {
            setActiveChannelId(channel.id);
            setChannelsOpen(false);
          }}
        >
          {channel.name}
        </button>
      ))}
    </>
  );

  const countPill = (
    <div className="pool-page__count-pill" role="group" aria-label="Stories shown at once">
      {SHOWN_OPTIONS.map((n) => (
        <button
          key={n}
          type="button"
          className={`pool-page__count-btn ${shownCount === n ? 'pool-page__count-btn--active' : ''}`}
          onClick={() => setShownCount(n)}
          aria-pressed={shownCount === n}
        >
          {n}
        </button>
      ))}
    </div>
  );

  return (
    <div className="pool-page">
      <div className="pool-page__header">
        {isMobile && (
          <button type="button" className="pool-page__back" onClick={() => navigate('/')} aria-label="Back to Home">
            <BackIcon />
          </button>
        )}
        <h1 className="pool-page__title">The Pool</h1>
        {/* A grid view makes no sense at phone width — hidden rather than shown-disabled, since
            there's nothing to toggle to (matches ChannelPage's identical reasoning). */}
        {!isMobile && (
          <ViewModeToggle value={settings.defaultViewMode} onChange={(mode) => update({ defaultViewMode: mode })} />
        )}
      </div>

      {channels.length > 0 &&
        (isMobile ? (
          <div className="pool-page__channels-mobile">
            <div className="pool-page__channels-row">
              <button
                type="button"
                className="pool-page__channels-trigger"
                onClick={() => setChannelsOpen((v) => !v)}
                aria-expanded={channelsOpen}
              >
                {activeChannelName ?? `Channels (${channels.length})`}
                <ChevronIcon open={channelsOpen} />
              </button>
              {countPill}
            </div>
            <div className={`pool-page__channels-panel ${channelsOpen ? 'pool-page__channels-panel--open' : ''}`}>
              <div className="pool-page__channels-panel-inner">
                <div className="pool-page__pills">{channelPills}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="pool-page__pills">
            {channelPills}
            {countPill}
          </div>
        ))}

      {isMobile && filtered.length > 0 && (
        <p className="pool-page__swipe-hint">Swipe to archive a story into its channel.</p>
      )}

      {loading && filtered.length === 0 ? (
        // Same reasoning as ChannelPage's identical branch: without this, a fresh/reloading Pool
        // falls through to NewsFeed with an empty array, which reads as "All caught up in Pool!"
        // for however long the fan-out fetch (one getArticles call per channel) takes.
        <FeedSkeleton />
      ) : !loading && filtered.length === 0 ? (
        <EmptyState
          title="No stories yet"
          body={channels.length === 0 ? 'Add a channel from Home to start filling the pool.' : 'Nothing here yet.'}
        />
      ) : (
        <NewsFeed
          articles={filtered}
          channelName="The Pool"
          viewMode={isMobile ? 'list' : settings.defaultViewMode}
          maxUnreadStories={shownCount}
          partitionByRead={false}
          catchUpMode
          showReadDimmed
          // Lets a story actually leave the Pool's own view on dismiss (swipe or checkmark) instead
          // of just sitting there dimmed forever — see the file doc comment above. Also what enables
          // the swipe gesture at all: NewsCard only turns it on when staysInPlace (!removeOnRead) is
          // false.
          removeOnRead
          removeCardOnUnbookmark={false}
          swipeToastText={(channelName) =>
            channelName ? `Marked read — filed to ${channelName}.` : 'Marked read.'
          }
          trustedSourceDomains={trustedSourceDomains}
          onToggleTrust={onToggleTrust}
        />
      )}
    </div>
  );
}
