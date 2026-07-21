import { useChannels } from '../../hooks/useChannels';
import { useChannelNewCounts } from '../../hooks/useChannelNewCounts';
import { ChannelSearchBar } from './ChannelSearchBar';
import { ChannelTabGrid } from './ChannelTabGrid';
import { RollTheDiceButton } from './RollTheDiceButton';
import { EmptyState } from '../common/EmptyState';
import './HomePage.css';

export function HomePage() {
  const { channels, loading } = useChannels();
  const { counts, total } = useChannelNewCounts(channels);

  return (
    <div className="home-page">
      <div className="home-page__utility-bar">
        <ChannelSearchBar />
      </div>

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
              {channels.length} channel{channels.length === 1 ? '' : 's'} · {total} stor
              {total === 1 ? 'y' : 'ies'} to catch up on
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
