import { Link } from 'react-router-dom';
import { getTileColor } from '../../utils/channelColor';
import type { Channel } from '../../../ipc-contract';
import './ChannelTabGrid.css';

function ChannelCard({ channel, newCount }: { channel: Channel; newCount: number }) {
  const subchannelText =
    channel.subchannels.length > 0
      ? `${channel.subchannels.length} subchannel${channel.subchannels.length === 1 ? '' : 's'}`
      : 'No subchannels';

  return (
    <Link className="channel-tile" style={{ background: getTileColor(channel.id) }} to={`/channel/${channel.id}`}>
      <div className="channel-tile__count">{newCount > 0 ? newCount : ''}</div>
      <div>
        <div className="channel-tile__name">{channel.name}</div>
        <div className="channel-tile__meta">
          {subchannelText}
          {newCount > 0 ? ' · new' : ''}
        </div>
      </div>
    </Link>
  );
}

interface ChannelTabGridProps {
  channels: Channel[];
  counts: Record<string, number>;
}

export function ChannelTabGrid({ channels, counts }: ChannelTabGridProps) {
  return (
    <div className="channel-grid">
      {channels.map((channel) => (
        <ChannelCard key={channel.id} channel={channel} newCount={counts[channel.id] ?? 0} />
      ))}
    </div>
  );
}
