import './ChannelChecklist.css';

interface ChannelChecklistProps {
  channels: { id: string; name: string }[];
  isChecked: (channelId: string) => boolean;
  onToggle: (channelId: string) => void;
  emptyLabel?: string;
}

/** Bigger, easier-to-click checkboxes than the browser default — shared by RollTheDiceSettings
 * and DigestSetting's channel picker so both look and feel identical rather than each styling
 * their own checkbox input slightly differently. */
export function ChannelChecklist({ channels, isChecked, onToggle, emptyLabel = 'No channels yet.' }: ChannelChecklistProps) {
  if (channels.length === 0) {
    return <div className="channel-checklist__empty">{emptyLabel}</div>;
  }
  return (
    <div className="channel-checklist">
      {channels.map((channel) => (
        <label key={channel.id} className="channel-checklist__row">
          <input
            type="checkbox"
            className="channel-checklist__checkbox"
            checked={isChecked(channel.id)}
            onChange={() => onToggle(channel.id)}
          />
          <span>{channel.name}</span>
        </label>
      ))}
    </div>
  );
}
