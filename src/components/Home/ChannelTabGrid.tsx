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

/** Where the dragged tile's wrap sat, in viewport coordinates, at the instant the drag armed —
 * position:fixed uses the same coordinate space, so the floating ghost (below) can be seeded from
 * this once and then just add the live pointer delta, with no dependency on wherever CSS Grid
 * decides to auto-place the tile's own (now-hidden) DOM node as the reorder preview shuffles other
 * tiles around it. */
interface OriginRect {
  top: number;
  left: number;
  width: number;
  height: number;
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
  /** The element pointer capture was set on — see the long comment at the arm point below for why
   * this is the grid container, not the tile that was actually pressed. */
  captureEl: HTMLDivElement;
  origin: OriginRect;
}

/** A press-and-hold not yet committed to a drag — cancelled by releasing early (a tap) or by
 * moving far enough that it reads as a scroll instead of a hold. Separate from TouchDragRef, which
 * only exists once a drag is actually live. */
interface PendingLongPress {
  pointerId: number;
  channelId: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  timerId: number;
  tileEl: HTMLElement;
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// How close to the scroll container's top/bottom edge (in px) the finger has to be before it starts
// auto-scrolling, and how fast that scroll moves per frame. Fixed-speed rather than distance-scaled
// — simpler to get right, and ten-plus channels in a two-column grid only need a modest scroll.
const AUTO_SCROLL_EDGE_PX = 60;
const AUTO_SCROLL_SPEED_PX = 12;

// How long a touch has to hold still before it commits to a drag, and how far it's allowed to
// wander during that hold before it reads as a scroll intent instead (cancelling the hold and
// leaving native scrolling completely alone — the hold never calls preventDefault/setPointerCapture
// until it actually fires).
const LONG_PRESS_MS = 420;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export function ChannelTabGrid({ channels, counts }: ChannelTabGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  // Live translate offset for the tile currently being touch-dragged — null whenever no touch drag
  // is in progress (including the entire mouse/HTML5-drag path, which never sets this at all; the
  // browser's own native drag ghost covers that case instead).
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);
  const touchRef = useRef<TouchDragRef | null>(null);
  const pendingRef = useRef<PendingLongPress | null>(null);
  // Set right as a touch drag ends, so the synthetic `click` the browser fires right after that
  // same pointerup doesn't also navigate the Link — cleared the moment that click is swallowed (or
  // never set at all for a plain tap, which never arms a drag in the first place).
  const justDraggedRef = useRef(false);

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
  // The floating ghost (position:fixed, see the render below) needs no help from this — it tracks
  // the finger in viewport space regardless of how far the page underneath has scrolled.
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

  // Fires once the long-press hold has been held still for LONG_PRESS_MS — commits to an actual
  // drag from wherever the finger currently is (not the original press point, which may have
  // wandered a little within tolerance during the hold).
  const armLongPress = (p: PendingLongPress) => {
    pendingRef.current = null;
    const gridEl = p.tileEl.closest<HTMLDivElement>('.channel-grid');
    if (!gridEl) return;
    gridEl.setPointerCapture(p.pointerId);
    const rect = p.tileEl.getBoundingClientRect();
    touchRef.current = {
      pointerId: p.pointerId,
      startX: p.lastX,
      startY: p.lastY,
      rafId: 0,
      pendingOffset: { x: 0, y: 0 },
      scrollRafId: 0,
      lastClientY: p.lastY,
      captureEl: gridEl,
      origin: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    };
    setDrag({ draggingId: p.channelId, overId: null, baseOrder: channels.map((c) => c.id) });
    setTouchOffset({ x: 0, y: 0 });
    startAutoScroll(gridEl);
  };

  const cancelPendingLongPress = (pointerId: number) => {
    const p = pendingRef.current;
    if (p && p.pointerId === pointerId) {
      window.clearTimeout(p.timerId);
      pendingRef.current = null;
    }
  };

  const finishTouchDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = touchRef.current;
    if (!t || e.pointerId !== t.pointerId) return;
    if (t.rafId) cancelAnimationFrame(t.rafId);
    stopAutoScroll();
    t.captureEl.releasePointerCapture(e.pointerId);
    touchRef.current = null;
    // Swallow the click the browser is about to fire right after this pointerup — but only THAT
    // one: self-clears shortly after in case no click ever actually arrives to consume it (some
    // browsers skip the click entirely once a touchmove in the gesture called preventDefault), so a
    // completed drag can never leave this stuck "true" and silently eat the next unrelated tap.
    justDraggedRef.current = true;
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 400);
    commitReorder(preview);
    setDrag(null);
    setArmedId(null);
    setTouchOffset(null);
  };

  // Unmounting mid-drag (e.g. navigating away) must not leave a rAF loop or a pending timer running
  // against a gone component — same reasoning as every other rAF/timer cleanup in this app.
  useEffect(() => {
    return () => {
      const t = touchRef.current;
      if (t?.rafId) cancelAnimationFrame(t.rafId);
      if (t?.scrollRafId) cancelAnimationFrame(t.scrollRafId);
      if (pendingRef.current) window.clearTimeout(pendingRef.current.timerId);
    };
  }, []);

  const clear = (e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    void api.clearChannel(channelId);
    revalidateNow();
  };

  // Count/name/meta content shared by both the real tile (inside its Link) and the floating drag
  // ghost (below), so the two can never visually drift apart.
  const tileInner = (channel: Channel) => {
    const count = counts[channel.id];
    const unread = count?.unread ?? 0;
    const hasNew = (count?.recent ?? 0) > 0;
    const paused = isChannelPaused(channel.pausedUntil);
    const subchannelText =
      channel.subchannels.length > 0
        ? `${channel.subchannels.length} subchannel${channel.subchannels.length === 1 ? '' : 's'}`
        : 'No subchannels';
    return (
      <>
        <div className="channel-tile__count">{unread > 0 ? unread : ''}</div>
        <div>
          <div className="channel-tile__name">{channel.name}</div>
          <div className="channel-tile__meta">
            {paused ? 'Paused' : subchannelText}
            {!paused && hasNew ? ' · new' : ''}
          </div>
        </div>
      </>
    );
  };

  const draggingChannel = drag ? byId.get(drag.draggingId) : undefined;
  const ghostOrigin = touchRef.current?.origin;
  const showGhost = !!draggingChannel && !!touchOffset && !!ghostOrigin;

  return (
    <div
      className={`channel-grid ${drag ? 'channel-grid--dragging' : ''}`}
      // Both the long-press hold (before it's armed a real drag) and the live touch-drag itself are
      // tracked from HERE, not from the tile that was actually pressed — a captured pointer's
      // events stop targeting a DOM node that's been physically repositioned among its siblings
      // (which is exactly what happens once React reorders `ordered` to match the live preview), so
      // anything bound to the tile itself would silently lose the gesture mid-drag. The grid
      // container never moves, so capturing there survives the reorder.
      onPointerMove={(e) => {
        const p = pendingRef.current;
        if (p && e.pointerId === p.pointerId) {
          p.lastX = e.clientX;
          p.lastY = e.clientY;
          if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > LONG_PRESS_MOVE_TOLERANCE_PX) {
            // Wandered enough to read as a scroll, not a hold — let it go. Nothing was ever
            // captured or prevented, so native scrolling has been free to happen the whole time.
            window.clearTimeout(p.timerId);
            pendingRef.current = null;
          }
        }
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
        // a touch gesture. The dragged tile's own slot is visibility:hidden while lifted (see the
        // render below), so elementFromPoint naturally finds whatever's underneath instead of
        // always finding itself.
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
      onPointerUp={(e) => {
        cancelPendingLongPress(e.pointerId);
        finishTouchDrag(e);
      }}
      onPointerCancel={(e) => {
        cancelPendingLongPress(e.pointerId);
        finishTouchDrag(e);
      }}
    >
      {ordered.map((channel) => {
        const isDraggingThis = drag?.draggingId === channel.id;
        const isTouchLifted = isDraggingThis && !!touchOffset;

        return (
          <div
            key={channel.id}
            data-channel-id={channel.id}
            className={`channel-tile-wrap ${isTouchLifted ? 'channel-tile-wrap--touch-source' : isDraggingThis ? 'channel-tile-wrap--dragging' : ''}`}
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
            // Touch only: press-and-hold anywhere on the tile arms a drag after LONG_PRESS_MS,
            // unless it's released early (a tap — handled by the grid's onPointerUp/cancelPendingLongPress
            // above, which lets the Link's own onClick navigate normally) or the finger wanders past
            // tolerance first (a scroll — see the grid's onPointerMove above). Skips presses that
            // started on the always-visible controls, which have their own instant tap behavior.
            onPointerDown={(e) => {
              if (e.pointerType !== 'touch') return;
              if ((e.target as HTMLElement).closest('.channel-tile__controls, .channel-tile__handle')) return;
              const pointerId = e.pointerId;
              const startX = e.clientX;
              const startY = e.clientY;
              const tileEl = e.currentTarget;
              const timerId = window.setTimeout(() => {
                const p = pendingRef.current;
                if (p && p.pointerId === pointerId) armLongPress(p);
              }, LONG_PRESS_MS);
              pendingRef.current = { pointerId, channelId: channel.id, startX, startY, lastX: startX, lastY: startY, timerId, tileEl };
            }}
          >
            <Link
              className={`channel-tile ${isChannelPaused(channel.pausedUntil) ? 'channel-tile--paused' : ''}`}
              style={{ background: getTileColor(channel.id) }}
              to={`/channel/${channel.id}`}
              draggable={false}
              onClick={(e) => {
                if (justDraggedRef.current) {
                  e.preventDefault();
                  justDraggedRef.current = false;
                }
              }}
            >
              {tileInner(channel)}
            </Link>

            {/* Drag handle (top-left), desktop/mouse only — hidden on mobile (see CSS), where the
                whole tile itself is the long-press target instead. Arms the wrapper for a mouse
                drag on press; the touch path lives on the wrapper's own onPointerDown above. */}
            <button
              type="button"
              className="channel-tile__handle"
              title="Drag to reorder"
              aria-label={`Reorder ${channel.name}`}
              onPointerDown={(e) => {
                if (e.pointerType !== 'mouse') return;
                setArmedId(channel.id);
              }}
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

            {/* Always-visible mini controls (bottom-right): pause + clear (clear is desktop-only —
                see CSS; mobile relies on the channel view's own clear, not a Home-tile shortcut). */}
            <div className="channel-tile__controls">
              <PauseChannelControl channelId={channel.id} pausedUntil={channel.pausedUntil} variant="icon" />
              <button
                type="button"
                className="channel-tile__ctrl channel-tile__ctrl--clear"
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

      {/* Floating drag ghost — the ONLY visible representation of the tile being touch-dragged.
          position:fixed roots it in viewport coordinates (the same space getBoundingClientRect and
          clientX/clientY already use), seeded once from where the tile actually sat when the drag
          armed (origin) plus the live pointer delta (touchOffset) — completely independent of
          wherever CSS Grid auto-places the tile's own (hidden) DOM node as the reorder preview
          reshuffles the OTHER tiles around it. That independence is what fixes the old jump/jutter:
          previously the dragged tile's real node carried the translate, so the instant it got
          reflowed into a new grid cell (which happens as soon as the finger crosses into another
          tile's bounds) the translate suddenly applied against a different base position. */}
      {showGhost && draggingChannel && touchOffset && ghostOrigin && (
        <div
          className="channel-tile-ghost"
          style={{
            top: ghostOrigin.top,
            left: ghostOrigin.left,
            width: ghostOrigin.width,
            height: ghostOrigin.height,
            transform: `translate(${touchOffset.x}px, ${touchOffset.y}px)`,
          }}
        >
          <div
            className={`channel-tile ${isChannelPaused(draggingChannel.pausedUntil) ? 'channel-tile--paused' : ''}`}
            style={{ background: getTileColor(draggingChannel.id) }}
          >
            {tileInner(draggingChannel)}
          </div>
        </div>
      )}
    </div>
  );
}
