import { useChannels } from '../../hooks/useChannels';
import { useSettings } from '../../hooks/useSettings';
import { SettingsAccordion } from './SettingsAccordion';
import { ChannelChecklist } from './ChannelChecklist';
import './RollTheDiceSettings.css';

export function RollTheDiceSettings() {
  const { channels } = useChannels();
  const { settings, update } = useSettings();
  const selected = settings.rollTheDiceChannelIds;

  const isChecked = (channelId: string) => selected == null || selected.includes(channelId);
  const includedCount = selected == null ? channels.length : selected.length;

  const toggle = (channelId: string) => {
    // First-ever toggle starts from "every channel" (null) — expand it to an explicit list before
    // flipping the one the user clicked, otherwise there's nothing to remove/add to.
    const current = selected == null ? channels.map((c) => c.id) : selected;
    const next = current.includes(channelId)
      ? current.filter((id) => id !== channelId)
      : [...current, channelId];
    update({ rollTheDiceChannelIds: next });
  };

  return (
    <div className="roll-the-dice-settings">
      <p className="roll-the-dice-settings__hint">
        Choose which channels "Roll the dice" can pull a random story from. New channels are included by default.
      </p>

      <SettingsAccordion
        label="Channels"
        subtitle={channels.length === 0 ? 'none yet' : `${includedCount} of ${channels.length} included`}
      >
        <ChannelChecklist channels={channels} isChecked={isChecked} onToggle={toggle} />
      </SettingsAccordion>
    </div>
  );
}
