import { useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useChannels } from '../../hooks/useChannels';
import './ChannelSearchBar.css';

export function ChannelSearchBar() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const { channels } = useChannels();
  const navigate = useNavigate();

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return channels.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 5);
  }, [channels, query]);

  const goToChannel = (channelId: string) => {
    setQuery('');
    setFocused(false);
    navigate(`/channel/${channelId}`);
  };

  const submit = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const exact = channels.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      goToChannel(exact.id);
      return;
    }
    const channel = await api.createChannel(trimmed);
    goToChannel(channel.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <div className="channel-search">
      <input
        className="channel-search__input"
        type="text"
        placeholder="Search or add a topic — any subject on earth…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        aria-label="Search or add a channel"
      />
      <p className="channel-search__hint">Press Enter to open an existing channel or create a new one.</p>
      {focused && matches.length > 0 && (
        <div className="channel-search__suggestions" role="listbox">
          {matches.map((c) => (
            <div
              key={c.id}
              className="channel-search__suggestion"
              role="option"
              aria-selected={false}
              onMouseDown={() => goToChannel(c.id)}
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
