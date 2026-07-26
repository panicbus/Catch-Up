import { useState, type KeyboardEvent } from 'react';
import './OnboardingChannelPicker.css';

interface OnboardingChannelPickerProps {
  names: string[];
  onChange: (names: string[]) => void;
}

export function OnboardingChannelPicker({ names, onChange }: OnboardingChannelPickerProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (names.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...names, trimmed]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      if (draft.trim()) e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && names.length > 0) {
      onChange(names.slice(0, -1));
    }
  };

  return (
    <div className="channel-picker">
      <div className="channel-picker__input-row">
        <input
          className="channel-picker__input"
          type="text"
          placeholder="e.g. Art, Local Politics, Bruce Springsteen… press tab to add."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          aria-label="Add a channel"
        />
      </div>
      <ul className="channel-picker__chips" aria-label="Selected channels">
        {names.map((name) => (
          <li key={name} className="channel-picker__chip">
            {name}
            <button
              type="button"
              className="channel-picker__chip-remove"
              onClick={() => onChange(names.filter((n) => n !== name))}
              aria-label={`Remove ${name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
