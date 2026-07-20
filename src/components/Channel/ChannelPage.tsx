import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useChannels } from '../../hooks/useChannels';
import { useArticles } from '../../hooks/useArticles';
import { useSettings } from '../../hooks/useSettings';
import { SubchannelBar } from './SubchannelBar';
import { SubchannelManagePanel } from '../common/SubchannelManagePanel';
import { ViewModeToggle } from './ViewModeToggle';
import { NewsFeed } from './NewsFeed';
import { EmptyState } from '../common/EmptyState';
import { Button } from '../common/Button';
import { api } from '../../services/api';
import './ChannelPage.css';

export function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const { channels } = useChannels();
  const { settings, update } = useSettings();
  const [subchannelId, setSubchannelId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [managingSubchannels, setManagingSubchannels] = useState(false);

  const channel = channels.find((c) => c.id === channelId) ?? null;
  const { articles, loading } = useArticles(channelId ?? null, subchannelId);

  if (!channel) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshNote(null);
    const result = await api.refreshChannel(channel.id);
    setRefreshing(false);

    const rateLimitNote =
      result.rateLimitedProviders.length > 0
        ? ` (${result.rateLimitedProviders.join(', ')} ${result.rateLimitedProviders.length === 1 ? 'is' : 'are'} rate-limited right now — showing results from other sources.)`
        : '';

    if (result.errors.length > 0) {
      setRefreshNote(`Refresh hit an error: ${result.errors[0]}${rateLimitNote}`);
    } else if (result.added === 0) {
      setRefreshNote(`No new stories found.${rateLimitNote}`);
    } else {
      setRefreshNote(`Found ${result.added} new stor${result.added === 1 ? 'y' : 'ies'}.${rateLimitNote}`);
    }
  };

  return (
    <div className="channel-page">
      <div className="channel-page__header">
        <h1 className="channel-page__title">{channel.name}</h1>
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {refreshNote && <p className="channel-page__refresh">{refreshNote}</p>}

      <div className="channel-page__controls">
        <SubchannelBar
          subchannels={channel.subchannels}
          activeId={subchannelId}
          onSelect={setSubchannelId}
          managing={managingSubchannels}
          onManageClick={() => setManagingSubchannels((v) => !v)}
        />
        <ViewModeToggle value={settings.defaultViewMode} onChange={(mode) => update({ defaultViewMode: mode })} />
      </div>

      {managingSubchannels && (
        <SubchannelManagePanel channel={channel} onClose={() => setManagingSubchannels(false)} />
      )}

      {!loading && articles.length === 0 ? (
        <EmptyState
          title="No stories yet"
          body="Catch Up checks for new stories every 30 minutes. Hit Refresh to check now."
        />
      ) : (
        <NewsFeed
          articles={articles}
          channelId={channel.id}
          channelName={channel.name}
          viewMode={settings.defaultViewMode}
        />
      )}
    </div>
  );
}
