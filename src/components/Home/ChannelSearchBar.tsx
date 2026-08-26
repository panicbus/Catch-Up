import { useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, revalidateNow } from '../../services/api';
import * as channelsStore from '../../services/channelsStore';
import { useChannels } from '../../hooks/useChannels';
import { capitalizeWords, slugifyChannelName } from '../../../channelName';
import './ChannelSearchBar.css';

export function ChannelSearchBar() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { channels } = useChannels();
  const navigate = useNavigate();

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return channels.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 5);
  }, [channels, query]);

  const goToChannel = (slug: string) => {
    setQuery('');
    setFocused(false);
    setError(null);
    navigate(`/channel/${slug}`);
  };

  const submit = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    // Same normalization dataStore.createChannel uses to decide "does this channel already
    // exist" — a plain lowercase comparison here could disagree with the backend's own slug-based
    // check and call createChannel (which always triggers an immediate refresh) for a channel
    // that already exists under a slightly different spelling/punctuation.
    const exact = channels.find((c) => c.slug === slugifyChannelName(trimmed));
    if (exact) {
      goToChannel(exact.slug);
      return;
    }
    // Optimistic so the sidebar/Home tile shows up right away, but navigation still waits for the
    // real record — the URL needs the server's real id, not a placeholder that would 404 the page.
    const name = capitalizeWords(trimmed);
    const tempId = `temp-${Date.now()}`;
    try {
      const channel = await channelsStore.mutate(
        (prev) => [
          ...prev,
          {
            id: tempId,
            name,
            slug: slugifyChannelName(name),
            createdAt: new Date().toISOString(),
            sortOrder: prev.length,
            subchannels: [],
            pausedUntil: null,
            pausedLabel: null,
          },
        ],
        async () => {
          const real = await api.createChannel(trimmed);
          const current = channelsStore.getSnapshot() ?? [];
          channelsStore.ingest(current.map((c) => (c.id === tempId ? real : c)));
          return real;
        }
      );
      revalidateNow();
      goToChannel(channel.slug);
    } catch (e) {
      // Surfaces real server messages (e.g. the per-account channel cap) instead of a generic
      // string that would make the cap look like a silent no-op.
      setError(e instanceof Error ? e.message : 'Could not create that channel. Try again.');
      console.error('[ChannelSearchBar] createChannel failed', e);
    }
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
      <svg
        className="channel-search__icon"
        viewBox="0 0 20 20"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="M13.5 13.5l4 4" />
      </svg>
      <input
        className="channel-search__input"
        type="text"
        placeholder="Add a topic, any subject on earth…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        aria-label="Search or add a channel"
      />
      {focused && matches.length > 0 && (
        <div className="channel-search__suggestions" role="listbox">
          {matches.map((c) => (
            <div
              key={c.id}
              className="channel-search__suggestion"
              role="option"
              aria-selected={false}
              onMouseDown={() => goToChannel(c.slug)}
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
      {error && <div className="channel-search__error">{error}</div>}
    </div>
  );
}
