import { useChannels } from '../../hooks/useChannels';
import { ChannelSearchBar } from './ChannelSearchBar';
import { ChannelTabGrid } from './ChannelTabGrid';
import { SurpriseMeButton } from './SurpriseMeButton';
import { EmptyState } from '../common/EmptyState';
import './HomePage.css';

export function HomePage() {
  const { channels, loading } = useChannels();

  return (
    <div className="home-page">
      <h1 className="home-page__title">Catch Up</h1>
      <p className="home-page__subtitle">Your topics. Your pace. All caught up.</p>
      <ChannelSearchBar />
      <SurpriseMeButton />
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
