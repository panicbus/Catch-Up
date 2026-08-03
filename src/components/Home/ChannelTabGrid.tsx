import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

/** Transient per-gesture data for a touch drag — kept in a ref (not state) since most of it changes
 * every pointermove and must never itself trigger a re-render; only touchOffset (below) does. */
interface TouchDragRef {
  pointerId: number;
  startX: number;
  startY: number;
  rafId: number;
  pendingOffset: { x: number; y: number };
  scrollRafId: number;
  lastClientY: number;
  /** The element pointer capture was set on — see the long comment at the pointerdown handler for
   * why this is the grid container, not the grip button that was actually pressed. */
  captureEl: HTMLDivElement;
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// How close to the scroll container's top/bottom edge (in px) the finger has to be before it starts
// auto-scrolling, and how fast that scroll moves per frame. Fixed-speed rather than distance-scaled
// — simpler to get right, and ten-plus channels in a two-column grid only need a modest scroll.
const AUTO_SCROLL_EDGE_PX = 60;
const AUTO_SCROLL_SPEED_PX = 12;

export function ChannelTabGrid({ channels, counts }: ChannelTabGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  // Live translate offset for the tile currently being touch-dragged — null whenever no touch drag
  // is in progress (including the entire mouse/HTML5-drag path, which never sets this at all; the
  // browser's own native drag ghost covers that case instead).
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);
  const touchRef = useRef<TouchDragRef | null>(null);

  // Derived, not accumulated. The previous version recomputed `to = prev.indexOf(targetId)`
  // against its OWN last output, so re-entering the same tile (which `dragenter` does 2-5 times per
  // tile — it bubbles from every child element inside it) flipped the order back and forth: the
  // drag "took" or didn't depending on the parity of how many child boundaries the cursor crossed.
  // A pure function of (baseOrder, draggingId, overId) can't oscillate — the same overId always
  // produces the same array, however many times it's recomputed. Touch dragging feeds this same
  // state (overId set from elementFromPoint instead of a dragenter event) so both input paths share
  // one reorder algorithm and one commit path (commitReorder, below).
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

  // Shared commit point for BOTH the mouse/HTML5 path (onDragEnd) and the touch path (pointerup) —
  // one place that can decide "did the order actually change" and fire exactly one setChannelOrder,
  // so the two input methods can't diverge on that logic.
  const commitReorder = (finalOrder: string[] | null) => {
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
  };

  const stopAutoScroll = () => {
    const t = touchRef.current;
    if (t?.scrollRafId) cancelAnimationFrame(t.scrollRafId);
  };

  // Scrolls .app-shell__main (the app's real scroll container — see AppShell.css) while the finger
  // sits near its top/bottom edge. Genuinely needed: ten-plus channels in a two-column mobile grid
  // don't fit on one screen, so a drag that starts near the bottom has nowhere to go without this.
  const startAutoScroll = (fromEl: HTMLElement) => {
    const scrollRoot = fromEl.closest<HTMLElement>('.app-shell__main');
    if (!scrollRoot) return;
    const tick = () => {
      const t = touchRef.current;
      if (!t) return; // drag already ended
      const rect = scrollRoot.getBoundingClientRect();
      if (t.lastClientY < rect.top + AUTO_SCROLL_EDGE_PX) {
        scrollRoot.scrollBy({ top: -AUTO_SCROLL_SPEED_PX });
      } else if (t.lastClientY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
        scrollRoot.scrollBy({ top: AUTO_SCROLL_SPEED_PX });
      }
      t.scrollRafId = requestAnimationFrame(tick);
    };
    touchRef.current!.scrollRafId = requestAnimationFrame(tick);
  };

  const finishTouchDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = touchRef.current;
    if (!t || e.pointerId !== t.pointerId) return;
    if (t.rafId) cancelAnimationFrame(t.rafId);
    stopAutoScroll();
    t.captureEl.releasePointerCapture(e.pointerId);
    touchRef.current = null;
    commitReorder(preview);
    setDrag(null);
    setArmedId(null);
    setTouchOffset(null);
  };

  // Unmounting mid-drag (e.g. navigating away) must not leave a rAF loop running against a gone
  // component — same reasoning as every other rAF/timer cleanup in this app.
  useEffect(() => {
    return () => {
      const t = touchRef.current;
      if (t?.rafId) cancelAnimationFrame(t.rafId);
      if (t?.scrollRafId) cancelAnimationFrame(t.scrollRafId);
    };
  }, []);

  const clear = (e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    void api.clearChannel(channelId);
  };

  return (
    <div
      className={`channel-grid ${drag ? 'channel-grid--dragging' : ''}`}
      // Touch drag's move/up/cancel listeners live HERE, not on the grip button that started the
      // gesture — see the pointerdown handler below for why. Guarded on touchRef being set, so this
      // is a no-op for any pointer movement that isn't an active touch drag (ordinary scrolling,
      // taps elsewhere, etc.).
      onPointerMove={(e) => {
        const t = touchRef.current;
        if (!t || e.pointerId !== t.pointerId) return;
        e.preventDefault();
        t.lastClientY = e.clientY;
        t.pendingOffset = { x: e.clientX - t.startX, y: e.clientY - t.startY };
        if (!t.rafId) {
          t.rafId = requestAnimationFrame(() => {
            const cur = touchRef.current;
            if (!cur) return;
            cur.rafId = 0;
            setTouchOffset(cur.pendingOffset);
          });
        }
        // The touch equivalent of onDragEnter — dragenter only fires from real HTML5 drag sources,
        // never from touch, so this is what discovers "which tile is the finger over right now" for
        // a touch gesture. pointer-events:none on the lifted tile (see CSS) keeps this from just
        // finding itself.
        //
        // Only ADVANCES overId when the finger is actually over another tile — never clears it back
        // to null just because this one instant landed on the grid's own background (the 10px gaps
        // between cells). A real finger crosses those gaps constantly while dragging, and since the
        // drop commits whatever overId was live at release, a gap landed on at the exact moment of
        // lift-off would otherwise silently cancel an otherwise-clear reorder — confirmed live: an
        // unlucky last frame in a gap reverted the whole drop back to the original order.
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-channel-id]');
        if (el) {
          const overId = el.dataset.channelId ?? null;
          setDrag((d) => (d && d.overId !== overId ? { ...d, overId } : d));
        }
      }}
      onPointerUp={finishTouchDrag}
      onPointerCancel={finishTouchDrag}
    >
      {ordered.map((channel) => {
        const count = counts[channel.id];
        const unread = count?.unread ?? 0;
        const hasNew = (count?.recent ?? 0) > 0;
        const paused = isChannelPaused(channel.pausedUntil);
        const subchannelText =
          channel.subchannels.length > 0
            ? `${channel.subchannels.length} subchannel${channel.subchannels.length === 1 ? '' : 's'}`
            : 'No subchannels';
        const isDraggingThis = drag?.draggingId === channel.id;
        const isTouchLifted = isDraggingThis && !!touchOffset;

        return (
          <div
            key={channel.id}
            data-channel-id={channel.id}
            className={`channel-tile-wrap ${isTouchLifted ? 'channel-tile-wrap--touch-lifted' : isDraggingThis ? 'channel-tile-wrap--dragging' : ''}`}
            style={isTouchLifted ? { transform: `translate(${touchOffset.x}px, ${touchOffset.y}px)` } : undefined}
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
              // fires `drop` at all), and after an Escape cancel.
              commitReorder(preview);
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

            {/* Drag handle (top-left). Arms the wrapper for a mouse drag on press; on touch, this
                same button drives an entirely separate Pointer Events path (native HTML5 drag never
                fires from touch input at all) that reuses the exact same DragState/preview/
                commitReorder as the mouse path above — only how `overId` gets discovered differs
                (elementFromPoint instead of a dragenter event).
                Pointer capture is set on the GRID container (via e.currentTarget.closest), not on
                this button — confirmed by instrumenting a real touch drag: once the dragged tile's
                DOM node gets physically repositioned among its siblings (React reordering `ordered`
                to match the live preview), a captured pointer's events stop targeting this button
                and start hitting whatever's really under the finger instead — silently losing the
                drag mid-gesture with no error. The grid container never moves, so capturing there
                survives the reorder; move/up/cancel listeners live on the grid for the same reason
                (see its own props above). */}
            <button
              type="button"
              className="channel-tile__handle"
              title="Drag to reorder"
              aria-label={`Reorder ${channel.name}`}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse') {
                  setArmedId(channel.id);
                  return;
                }
                e.preventDefault();
                const gridEl = e.currentTarget.closest<HTMLDivElement>('.channel-grid');
                if (!gridEl) return;
                gridEl.setPointerCapture(e.pointerId);
                touchRef.current = {
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                  rafId: 0,
                  pendingOffset: { x: 0, y: 0 },
                  scrollRafId: 0,
                  lastClientY: e.clientY,
                  captureEl: gridEl,
                };
                setDrag({ draggingId: channel.id, overId: null, baseOrder: channels.map((c) => c.id) });
                setTouchOffset({ x: 0, y: 0 });
                startAutoScroll(gridEl);
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // `click` fires only when mousedown/up happened without an intervening drag — the
                // exact case a plain press-and-release on the grip needs to disarm. Without this, a
                // click here left the tile `draggable` indefinitely (armedId only ever cleared in
                // onDragEnd, which a non-drag click never reaches). Touch never reaches this at all
                // (its pointerdown branch returns before arming anything), which is fine — armedId
                // is a mouse-only concept.
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
