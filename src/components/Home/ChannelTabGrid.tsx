import { Link } from 'react-router-dom';
import { getTileColor } from '../../utils/channelColor';
import type { ChannelCount } from '../../hooks/useChannelCounts';
import type { Channel } from '../../../ipc-contract';
import './ChannelTabGrid.css';

function ChannelCard({ channel, count }: { channel: Channel; count?: ChannelCount }) {
  const unread = count?.unread ?? 0;
  const hasNew = (count?.recent ?? 0) > 0;
  const subchannelText =
    channel.subchannels.length > 0
      ? `${channel.subchannels.length} subchannel${channel.subchannels.length === 1 ? '' : 's'}`
      : 'No subchannels';

  return (
    <Link className="channel-tile" style={{ background: getTileColor(channel.id) }} to={`/channel/${channel.id}`}>
      <div className="channel-tile__count">{unread > 0 ? unread : ''}</div>
      <div>
        <div className="channel-tile__name">{channel.name}</div>
        <div className="channel-tile__meta">
          {subchannelText}
          {hasNew ? ' · new' : ''}
        </div>
      </div>
    </Link>
  );
}

interface ChannelTabGridProps {
  channels: Channel[];
  counts: Record<string, ChannelCount>;
}

export function ChannelTabGrid({ channels, counts }: ChannelTabGridProps) {
  return (
    <div className="channel-grid">
      {channels.map((channel) => (
        <ChannelCard key={channel.id} channel={channel} count={counts[channel.id]} />
      ))}
    </div>
  );
}
