import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTileColor } from '../../utils/channelColor';
import { api, revalidateNow } from '../../services/api';
import * as channelsStore from '../../services/channelsStore';
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

interface DragState {
  draggingId: string;
  /** The tile last entered — null until the pointer actually crosses another tile. */
  overId: string | null;
  /** The order at the moment this drag started — fixed for the whole gesture, so every preview
   * recompute starts from the same base instead of the previous preview (see `preview` below). */
  baseOrder: string[];
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function ChannelTabGrid({ channels, counts }: ChannelTabGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);

  // Derived, not accumulated. The previous version recomputed `to = prev.indexOf(targetId)`
  // against its OWN last output, so re-entering the same tile (which `dragenter` does 2-5 times per
  // tile — it bubbles from every child element inside it) flipped the order back and forth: the
  // drag "took" or didn't depending on the parity of how many child boundaries the cursor crossed.
  // A pure function of (baseOrder, draggingId, overId) can't oscillate — the same overId always
  // produces the same array, however many times it's recomputed.
  const preview = useMemo(() => {
    if (!drag) return null;
    const { draggingId, overId, baseOrder } = drag;
    if (!overId || overId === draggingId) return baseOrder;
    const without = baseOrder.filter((id) => id !== draggingId);
    const idx = without.indexOf(overId);
    if (idx === -1) return baseOrder;
    // Dragging forward (toward a later tile) drops AFTER the target; dragging backward drops
    // BEFORE it — this is what makes the preview land where it visually looks like it should
    // regardless of which direction the tile is moving.
    const insertAt = baseOrder.indexOf(draggingId) < baseOrder.indexOf(overId) ? idx + 1 : idx;
    return [...without.slice(0, insertAt), draggingId, ...without.slice(insertAt)];
  }, [drag]);

  const displayOrderIds = preview ?? channels.map((c) => c.id);
  const byId = new Map(channels.map((c) => [c.id, c]));
  const ordered = displayOrderIds.map((id) => byId.get(id)).filter((c): c is Channel => !!c);

  const clear = (e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    void api.clearChannel(channelId);
  };

  return (
    <div className={`channel-grid ${drag ? 'channel-grid--dragging' : ''}`}>
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
            className={`channel-tile-wrap ${drag?.draggingId === channel.id ? 'channel-tile-wrap--dragging' : ''}`}
            draggable={armedId === channel.id}
            onDragStart={(e) => {
              setDrag({ draggingId: channel.id, overId: null, baseOrder: channels.map((c) => c.id) });
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', channel.id);
            }}
            onDragEnter={() => setDrag((d) => (d ? { ...d, overId: channel.id } : d))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={() => {
              // dragend, not drop, is the one commit point: it ALWAYS fires exactly once when a
              // drag ends — after a valid drop, after a drop in the 14px grid gap (which never
              // fires `drop` at all), and after an Escape cancel. Committing here means exactly one
              // setChannelOrder call per gesture, instead of the old code's two (drop AND dragend
              // both called persistOrder).
              const finalOrder = preview;
              if (finalOrder && !sameOrder(finalOrder, channels.map((c) => c.id))) {
                channelsStore
                  .mutate(
                    (prev) => {
                      const prevById = new Map(prev.map((c) => [c.id, c]));
                      return finalOrder
                        .map((id, i) => {
                          const c = prevById.get(id);
                          return c ? { ...c, sortOrder: i } : null;
                        })
                        .filter((c): c is Channel => !!c);
                    },
                    () => api.setChannelOrder(finalOrder)
                  )
                  .then(() => revalidateNow())
                  .catch(() => {});
              }
              // Applying the reorder through channelsStore.mutate() (above) BEFORE clearing drag
              // state means the next render already shows the new order via the live `channels`
              // prop — there's no frame where `drag` is gone but the order hasn't caught up yet,
              // which is what used to make tiles visibly snap back to the old order (worse on the
              // web build, where there's no push and the snap-back used to stick for up to 20s).
              setDrag(null);
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
                // `click` fires only when mousedown/up happened without an intervening drag — the
                // exact case a plain press-and-release on the grip needs to disarm. Without this, a
                // click here left the tile `draggable` indefinitely (armedId only ever cleared in
                // onDragEnd, which a non-drag click never reaches).
                setArmedId(null);
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
