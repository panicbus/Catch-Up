import { useState } from 'react';
import { useChannels } from '../../hooks/useChannels';
import { useSettings } from '../../hooks/useSettings';
import './RollTheDiceSettings.css';

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function RollTheDiceSettings() {
  const { channels } = useChannels();
  const { settings, update } = useSettings();
  const [open, setOpen] = useState(false);
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

      <div className="roll-the-dice-settings__box">
        <button
          type="button"
          className="roll-the-dice-settings__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevronIcon open={open} />
          <span className="roll-the-dice-settings__toggle-label">Channels</span>
          <span className="roll-the-dice-settings__toggle-count">
            {channels.length === 0 ? 'none yet' : `${includedCount} of ${channels.length} included`}
          </span>
        </button>

        <div className={`roll-the-dice-settings__body ${open ? 'roll-the-dice-settings__body--open' : ''}`}>
          <div className="roll-the-dice-settings__body-inner">
            {channels.length === 0 ? (
              <div className="roll-the-dice-settings__empty">No channels yet.</div>
            ) : (
              <div className="roll-the-dice-settings__list">
                {channels.map((channel) => (
                  <label key={channel.id} className="roll-the-dice-settings__row">
                    <input
                      type="checkbox"
                      checked={isChecked(channel.id)}
                      onChange={() => toggle(channel.id)}
                    />
                    <span>{channel.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
