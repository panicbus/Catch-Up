import { Link } from 'react-router-dom';
import { useArticles } from '../../hooks/useArticles';
import { isNewArticle } from '../../utils/isNew';
import type { Channel } from '../../../ipc-contract';
import './ChannelTabGrid.css';

function ChannelCard({ channel }: { channel: Channel }) {
  const { articles } = useArticles(channel.id, null);
  const newCount = articles.filter((a) => isNewArticle(a.publishedAt)).length;

  return (
    <Link className="channel-card" to={`/channel/${channel.id}`}>
      <span className="channel-card__name">{channel.name}</span>
      <span className="channel-card__meta">
        {channel.subchannels.length > 0
          ? `${channel.subchannels.length} subchannel${channel.subchannels.length === 1 ? '' : 's'}`
          : 'No subchannels'}
      </span>
      {newCount > 0 && <span className="channel-card__new-badge">{newCount} new</span>}
    </Link>
  );
}

interface ChannelTabGridProps {
  channels: Channel[];
}

export function ChannelTabGrid({ channels }: ChannelTabGridProps) {
  return (
    <div className="channel-grid">
      {channels.map((channel) => (
        <ChannelCard key={channel.id} channel={channel} />
      ))}
    </div>
  );
}
