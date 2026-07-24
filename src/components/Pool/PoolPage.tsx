import { useState } from 'react';
import { useChannels } from '../../hooks/useChannels';
import { usePoolArticles } from '../../hooks/usePoolArticles';
import { useSettings } from '../../hooks/useSettings';
import { ViewModeToggle } from '../Channel/ViewModeToggle';
import { NewsFeed } from '../Channel/NewsFeed';
import { EmptyState } from '../common/EmptyState';
import '../Channel/SubchannelBar.css';
import './PoolPage.css';

const SHOWN_OPTIONS = [10, 25, 50] as const;

/** Every channel's stories merged into one chronological feed — filterable down to a single
 * channel, but never a subchannel (that's what keeps this "a pool," not just another channel
 * view). Gets the same low-friction catch-up behavior as a channel (catchUpMode): scrolling past
 * or opening a story clears it in place, and reaching zero unread fires the celebration and bumps
 * the streak — clearing The Pool means you've read everything across every channel, the ultimate
 * catch-up. It has no per-day "Read stories" archive though (partitionByRead stays false), so a
 * story read via the check button is removed from view (removeOnRead) and passively-read ones drop
 * out on the next visit rather than moving to an archive. Unbookmarking, unlike on Bookmarks, does
 * NOT remove a card here — this is a general feed, not a bookmarks-only one. */
export function PoolPage() {
  const { channels } = useChannels();
  const { articles, loading } = usePoolArticles(channels);
  const { settings, update } = useSettings();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState<(typeof SHOWN_OPTIONS)[number]>(25);

  const filtered = activeChannelId ? articles.filter((a) => a.channelId === activeChannelId) : articles;

  return (
    <div className="pool-page">
      <div className="pool-page__header">
        <h1 className="pool-page__title">The Pool</h1>
        <ViewModeToggle value={settings.defaultViewMode} onChange={(mode) => update({ defaultViewMode: mode })} />
      </div>

      {channels.length > 0 && (
        <div className="pool-page__pills">
          <button
            type="button"
            className={`subchannel-bar__chip ${activeChannelId === null ? 'subchannel-bar__chip--active' : ''}`}
            onClick={() => setActiveChannelId(null)}
          >
            All
          </button>
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={`subchannel-bar__chip ${activeChannelId === channel.id ? 'subchannel-bar__chip--active' : ''}`}
              onClick={() => setActiveChannelId(channel.id)}
            >
              {channel.name}
            </button>
          ))}

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
        </div>
      )}

      {!loading && filtered.length === 0 ? (
        <EmptyState
          title="No stories yet"
          body={channels.length === 0 ? 'Add a channel from Home to start filling the pool.' : 'Nothing here yet.'}
        />
      ) : (
        <NewsFeed
          articles={filtered}
          channelName="The Pool"
          viewMode={settings.defaultViewMode}
          maxUnreadStories={shownCount}
          partitionByRead={false}
          removeOnRead
          catchUpMode
          removeCardOnUnbookmark={false}
        />
      )}
    </div>
  );
}
