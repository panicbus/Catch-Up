import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTileColor } from '../../utils/channelColor';
import { api } from '../../services/api';
import { PauseChannelControl, isChannelPaused } from '../common/PauseChannelControl';
import type { ChannelCount } from '../../hooks/useChannelCounts';
import type { Channel } from '../../../ipc-contract';
import './ChannelTabGrid.css';

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

interface ChannelTabGridProps {
  channels: Channel[];
  counts: Record<string, ChannelCount>;
}

export function ChannelTabGrid({ channels, counts }: ChannelTabGridProps) {
  // Local display order for live drag preview; re-synced from props whenever channels change and no
  // drag is in progress (a server broadcast after a reorder lands here).
  const [orderIds, setOrderIds] = useState<string[]>(channels.map((c) => c.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);

  useEffect(() => {
    if (!draggingId) setOrderIds(channels.map((c) => c.id));
  }, [channels, draggingId]);

  const byId = new Map(channels.map((c) => [c.id, c]));
  const ordered = orderIds.map((id) => byId.get(id)).filter((c): c is Channel => !!c);

  const reorderTo = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    setOrderIds((prev) => {
      const from = prev.indexOf(draggingId);
      const to = prev.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, draggingId);
      return next;
    });
  };

  const persistOrder = () => {
    void api.setChannelOrder(orderIds);
  };

  const clear = (e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    void api.clearChannel(channelId);
  };

  return (
    <div className="channel-grid">
      {ordered.map((channel) => {
        const count = counts[channel.id];
        const unread = count?.unread ?? 0;
        const hasNew = (count?.recent ?? 0) > 0;
        const paused = isChannelPaused(channel.pausedUntil);
        const subchannelText =
          channel.subchannels.length > 0
            ? `${channel.subchannels.length} subchannel${channel.subchannels.length === 1 ? '' : 's'}`
            : 'No subchannels';

        return (
          <div
            key={channel.id}
            className={`channel-tile-wrap ${draggingId === channel.id ? 'channel-tile-wrap--dragging' : ''}`}
            draggable={armedId === channel.id}
            onDragStart={(e) => {
              setDraggingId(channel.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', channel.id);
            }}
            onDragEnter={() => reorderTo(channel.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              persistOrder();
            }}
            onDragEnd={() => {
              persistOrder();
              setDraggingId(null);
              setArmedId(null);
            }}
          >
            <Link
              className={`channel-tile ${paused ? 'channel-tile--paused' : ''}`}
              style={{ background: getTileColor(channel.id) }}
              to={`/channel/${channel.id}`}
              draggable={false}
            >
              <div className="channel-tile__count">{unread > 0 ? unread : ''}</div>
              <div>
                <div className="channel-tile__name">{channel.name}</div>
                <div className="channel-tile__meta">
                  {paused ? 'Paused' : subchannelText}
                  {!paused && hasNew ? ' · new' : ''}
                </div>
              </div>
            </Link>

            {/* Drag handle (top-left). Arms the wrapper for dragging on press. */}
            <button
              type="button"
              className="channel-tile__handle"
              title="Drag to reorder"
              aria-label={`Reorder ${channel.name}`}
              onMouseDown={() => setArmedId(channel.id)}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <GripIcon />
            </button>

            {/* Always-visible mini controls (bottom-right): pause + clear. */}
            <div className="channel-tile__controls">
              <PauseChannelControl channelId={channel.id} pausedUntil={channel.pausedUntil} variant="icon" />
              <button
                type="button"
                className="channel-tile__ctrl"
                title="Clear — mark all read"
                aria-label={`Clear ${channel.name}`}
                onClick={(e) => clear(e, channel.id)}
              >
                <CheckIcon />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
