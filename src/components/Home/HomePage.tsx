import { useChannels } from '../../hooks/useChannels';
import { ChannelSearchBar } from './ChannelSearchBar';
import { ChannelTabGrid } from './ChannelTabGrid';
import { RollTheDiceButton } from './RollTheDiceButton';
import { EmptyState } from '../common/EmptyState';
import './HomePage.css';

export function HomePage() {
  const { channels, loading } = useChannels();

  return (
    <div className="home-page">
      <div className="home-page__search-row">
        <ChannelSearchBar />
      </div>
      <RollTheDiceButton />
      {!loading && channels.length === 0 ? (
        <EmptyState
          title="No channels yet"
          body="Search for a topic above to create your first channel."
        />
      ) : (
        <ChannelTabGrid channels={channels} />
      )}
    </div>
  );
}
