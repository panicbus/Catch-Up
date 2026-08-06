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

/** One grid cell's geometry, measured once at drag start and then treated as fixed for the whole
 * gesture. Stored RELATIVE TO THE GRID CONTAINER (not the viewport) so auto-scrolling the page
 * mid-drag doesn't invalidate any of it — the pointer gets converted into the same space on each
 * move. `id` is whichever channel occupied this cell when the drag began, i.e. slots[i].id is
 * always baseOrder[i]. */
interface Slot {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Transient per-gesture data for an active drag — mouse (armed instantly from the grip handle) and
 * touch (armed after the long-press hold) both funnel into this same shape, kept in a ref (not
 * state) since most of it changes every pointermove and must never itself trigger a re-render; only
 * touchOffset (below) does. */
interface DragRef {
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
  /** Every cell's geometry as of drag start, in base order. The single source of truth for both
   * "which cell is the pointer over" and "where should each displaced tile be drawn" — see the
   * render below for why nothing during a drag is ever measured off the live DOM. */
  slots: Slot[];
}

/** A press-and-hold not yet committed to a drag — cancelled by releasing early (a tap) or by
 * moving far enough that it reads as a scroll instead of a hold. Touch only; a mouse drag arms
 * immediately from the grip handle with no hold to wait out (see armDrag/the handle's onPointerDown
 * below), so it never goes through this pending state at all. */
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
  // Live translate offset for the tile currently being dragged (mouse or touch alike) — null
  // whenever no drag is in progress. Both input methods share this one floating-ghost rendering
  // path; there is no separate native-HTML5-drag-image path anymore (see armDrag below for why).
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<DragRef | null>(null);
  const pendingRef = useRef<PendingLongPress | null>(null);
  // Set right as a drag ends, so the synthetic `click` the browser fires right after that same
  // pointerup doesn't also navigate the Link — cleared the moment that click is swallowed (or never
  // set at all for a plain tap/click, which never arms a drag in the first place).
  const justDraggedRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Derived, not accumulated. An older version recomputed `to = prev.indexOf(targetId)` against its
  // OWN last output, so re-entering the same tile flipped the order back and forth: the drag "took"
  // or didn't depending on the parity of how many times the cursor had re-entered. A pure function
  // of (baseOrder, draggingId, overId) can't oscillate — the same overId always produces the same
  // array, however many times it's recomputed. Both input methods feed this one reorder algorithm
  // and share one commit path (commitReorder, below).
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

  const byId = new Map(channels.map((c) => [c.id, c]));

  // THE DOM ORDER NEVER CHANGES DURING A DRAG. Tiles are rendered in base order the whole time and
  // moved purely with transforms (see tileShift below) into wherever the live preview says they
  // belong. This is the fix for the "tiles fly around at high speed" bug, which had two compounding
  // causes, both of which this design removes by construction:
  //
  //  1. A FEEDBACK LOOP. Over-detection used to hit-test the live DOM (elementFromPoint), but the
  //     reorder that produced changed which tile sat under the pointer — which flipped the preview
  //     back, which moved the first tile under the pointer again. At any slot boundary that
  //     ping-ponged many times per second. Now the pointer is tested against slot geometry frozen
  //     at drag start (see armDrag), so a given pointer position always resolves to the same slot,
  //     no matter what the preview is currently showing. Reordering can no longer feed back into
  //     the thing that decides the reorder.
  //  2. COMPOUNDING MEASUREMENT ERROR. The old FLIP pass measured each tile with its previous
  //     animation's transform still applied, then stored that half-finished position as the
  //     starting point for the next animation — so the error grew every cycle, which is what made
  //     the motion look fast and wild rather than merely wrong. Nothing is measured off the live
  //     DOM anymore; every position is arithmetic on the frozen slot list, so there is no error to
  //     accumulate.
  //
  // A plain CSS transition on transform (see .channel-grid--dragging in the CSS) does the
  // animating. Interrupting one mid-flight is handled natively by the browser — it re-targets from
  // the current computed value — so dragging quickly across several slots stays smooth instead of
  // fighting a hand-rolled interpolation.
  const orderedIds = drag ? drag.baseOrder : channels.map((c) => c.id);
  const ordered = orderedIds.map((id) => byId.get(id)).filter((c): c is Channel => !!c);

  // Where a tile should be drawn right now: the offset from the cell it physically occupies (its
  // base slot, which is also where the browser has actually laid it out) to the cell the preview
  // wants it in. Undefined whenever it hasn't moved, so untouched tiles carry no transform at all.
  const slots = dragRef.current?.slots;
  const tileShift = (channelId: string): string | undefined => {
    if (!drag || !preview || !slots) return undefined;
    const from = slots.findIndex((s) => s.id === channelId);
    const to = preview.indexOf(channelId);
    if (from === -1 || to === -1 || from === to) return undefined;
    const a = slots[from];
    const b = slots[to];
    if (!a || !b) return undefined;
    return `translate(${b.left - a.left}px, ${b.top - a.top}px)`;
  };

  // Shared commit point for BOTH input methods — one place that can decide "did the order actually
  // change" and fire exactly one setChannelOrder, so mouse and touch can't diverge on that logic.
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
    const t = dragRef.current;
    if (t?.scrollRafId) cancelAnimationFrame(t.scrollRafId);
  };

  // Scrolls .app-shell__main (the app's real scroll container — see AppShell.css) while the pointer
  // sits near its top/bottom edge. Genuinely needed: ten-plus channels in a two-column mobile grid
  // don't fit on one screen, so a drag that starts near the bottom has nowhere to go without this.
  // The floating ghost (position:fixed, see the render below) needs no help from this — it tracks
  // the pointer in viewport space regardless of how far the page underneath has scrolled.
  const startAutoScroll = (fromEl: HTMLElement) => {
    const scrollRoot = fromEl.closest<HTMLElement>('.app-shell__main');
    if (!scrollRoot) return;
    const tick = () => {
      const t = dragRef.current;
      if (!t) return; // drag already ended
      const rect = scrollRoot.getBoundingClientRect();
      if (t.lastClientY < rect.top + AUTO_SCROLL_EDGE_PX) {
        scrollRoot.scrollBy({ top: -AUTO_SCROLL_SPEED_PX });
      } else if (t.lastClientY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
        scrollRoot.scrollBy({ top: AUTO_SCROLL_SPEED_PX });
      }
      t.scrollRafId = requestAnimationFrame(tick);
    };
    dragRef.current!.scrollRafId = requestAnimationFrame(tick);
  };

  // Begins a drag from wherever the pointer currently is — shared by the touch long-press timer
  // (armLongPress, below) and the desktop grip handle's immediate onPointerDown, so both input
  // methods drive the exact same floating-ghost rendering path. There is deliberately no separate
  // native-HTML5-drag-and-drop branch for mouse anymore: that API's browser-throttled dragover/
  // dragenter delivery and uncontrollable drag image were the actual source of the reported
  // desktop jutter, and can't be tuned away while still using it. Pointer capture is taken on the
  // GRID container (not the tile itself) for the same reason the rest of this file already does —
  // a captured pointer's events stop targeting a DOM node that's been physically repositioned among
  // its siblings, which is exactly what happens once React reorders `ordered` to match the live
  // preview.
  const armDrag = (pointerId: number, channelId: string, tileEl: HTMLElement, x: number, y: number) => {
    const gridEl = tileEl.closest<HTMLDivElement>('.channel-grid');
    if (!gridEl) return;
    gridEl.setPointerCapture(pointerId);
    const rect = tileEl.getBoundingClientRect();
    // Freeze the grid's geometry for the whole gesture. Nothing is laid out or re-measured again
    // until the drop: the DOM order stays put and tiles are moved with transforms, so these cells
    // stay exactly where they are and stay a valid map of "pointer position → slot". Stored
    // relative to the grid container so mid-drag auto-scrolling can't invalidate them. Measured
    // before any tile is hidden or transformed, so slots[i].id === baseOrder[i] by construction.
    const gridRect = gridEl.getBoundingClientRect();
    const slots: Slot[] = [...gridEl.querySelectorAll<HTMLElement>('[data-channel-id]')].flatMap((el) => {
      const id = el.dataset.channelId;
      if (!id) return [];
      const r = el.getBoundingClientRect();
      return [{ id, left: r.left - gridRect.left, top: r.top - gridRect.top, width: r.width, height: r.height }];
    });
    dragRef.current = {
      pointerId,
      startX: x,
      startY: y,
      rafId: 0,
      pendingOffset: { x: 0, y: 0 },
      scrollRafId: 0,
      lastClientY: y,
      captureEl: gridEl,
      origin: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      slots,
    };
    setDrag({ draggingId: channelId, overId: null, baseOrder: slots.map((s) => s.id) });
    setTouchOffset({ x: 0, y: 0 });
    startAutoScroll(gridEl);
  };

  // Fires once the long-press hold has been held still for LONG_PRESS_MS — commits to an actual
  // drag from wherever the finger currently is (not the original press point, which may have
  // wandered a little within tolerance during the hold).
  const armLongPress = (p: PendingLongPress) => {
    pendingRef.current = null;
    armDrag(p.pointerId, p.channelId, p.tileEl, p.lastX, p.lastY);
    // Belt-and-suspenders alongside the pointerdown-level preventDefault (see the tile wrapper's
    // onPointerDown below): clears anything iOS's native text-selection/callout gesture managed to
    // start in the brief window before that preventDefault took effect.
    window.getSelection()?.removeAllRanges();
  };

  const cancelPendingLongPress = (pointerId: number) => {
    const p = pendingRef.current;
    if (p && p.pointerId === pointerId) {
      window.clearTimeout(p.timerId);
      pendingRef.current = null;
    }
  };

  const finishDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = dragRef.current;
    if (!t || e.pointerId !== t.pointerId) return;
    if (t.rafId) cancelAnimationFrame(t.rafId);
    stopAutoScroll();
    t.captureEl.releasePointerCapture(e.pointerId);
    dragRef.current = null;
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
    setTouchOffset(null);
  };

  // Unmounting mid-drag (e.g. navigating away) must not leave a rAF loop or a pending timer running
  // against a gone component — same reasoning as every other rAF/timer cleanup in this app.
  useEffect(() => {
    return () => {
      const t = dragRef.current;
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
        <div className="channel-tile__count">{!paused && unread > 0 ? unread : ''}</div>
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
  const ghostOrigin = dragRef.current?.origin;
  const showGhost = !!draggingChannel && !!touchOffset && !!ghostOrigin;

  return (
    <div
      ref={gridRef}
      className={`channel-grid ${drag ? 'channel-grid--dragging' : ''}`}
      // Both the long-press hold (before it's armed a real drag) and the live drag itself are
      // tracked from HERE, not from the tile that was actually pressed — a captured pointer's
      // events stop targeting a DOM node that's been physically repositioned among its siblings
      // (which is exactly what happens once React reorders `ordered` to match the live preview), so
      // anything bound to the tile itself would silently lose the gesture mid-drag. The grid
      // container never moves, so capturing there survives the reorder. This handles BOTH input
      // methods — mouse drags (armed instantly from the grip handle) and touch drags (armed after
      // the long-press hold) — since neither branch below checks pointer type.
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
        const t = dragRef.current;
        if (!t || e.pointerId !== t.pointerId) return;
        e.preventDefault();
        t.lastClientY = e.clientY;
        t.pendingOffset = { x: e.clientX - t.startX, y: e.clientY - t.startY };
        if (!t.rafId) {
          t.rafId = requestAnimationFrame(() => {
            const cur = dragRef.current;
            if (!cur) return;
            cur.rafId = 0;
            setTouchOffset(cur.pendingOffset);
          });
        }
        // Which cell is the pointer over? Pure arithmetic against the slot geometry frozen at drag
        // start — deliberately NOT elementFromPoint against the live DOM, which is what made tiles
        // fly around: hit-testing the reordered DOM let the reorder decide its own input, so at a
        // slot boundary the preview ping-ponged every frame (see the long comment above `orderedIds`
        // in the render). Frozen geometry can't feed back, so a given pointer position resolves to
        // one stable answer no matter what's currently drawn there.
        //
        // Converted into grid space on every move rather than cached, so the answer stays right
        // even while auto-scroll is moving the page under the pointer.
        const gridBox = t.captureEl.getBoundingClientRect();
        const px = e.clientX - gridBox.left;
        const py = e.clientY - gridBox.top;
        const hit = t.slots.find(
          (s) => px >= s.left && px <= s.left + s.width && py >= s.top && py <= s.top + s.height
        );
        // Only ADVANCES overId when the pointer is genuinely inside a cell — never clears it back to
        // null just because this one instant landed in the gaps between cells. A real finger/cursor
        // crosses those constantly while dragging, and since the drop commits whatever overId was
        // live at release, a gap landed on at the exact instant of lift-off would otherwise silently
        // cancel an otherwise-clear reorder — confirmed live: an unlucky last frame in a gap
        // reverted the whole drop back to the original order.
        if (hit) {
          setDrag((d) => (d && d.overId !== hit.id ? { ...d, overId: hit.id } : d));
        }
      }}
      onPointerUp={(e) => {
        cancelPendingLongPress(e.pointerId);
        finishDrag(e);
      }}
      onPointerCancel={(e) => {
        cancelPendingLongPress(e.pointerId);
        finishDrag(e);
      }}
    >
      {ordered.map((channel) => {
        const isDraggingThis = drag?.draggingId === channel.id;

        return (
          <div
            key={channel.id}
            data-channel-id={channel.id}
            // The dragged tile's real slot is hidden (not display:none) the instant it's lifted, so
            // it keeps holding its cell open as a stable hole instead of the grid collapsing —
            // the floating ghost below is its only visible stand-in for the rest of the gesture.
            className={`channel-tile-wrap ${isDraggingThis ? 'channel-tile-wrap--touch-source' : ''}`}
            // Displaced tiles are moved into their previewed cell with a transform rather than by
            // being re-placed in the DOM — see the comment above `orderedIds` for why that's what
            // keeps this stable. The dragged tile itself is invisible, so it never needs one.
            style={isDraggingThis ? undefined : { transform: tileShift(channel.id) }}
            // Belt-and-suspenders alongside the CSS -webkit-touch-callout:none (see
            // ChannelTabGrid.css) — a long press on a link/text can still surface iOS's native
            // context menu even with that CSS in place in some cases; explicitly blocking the event
            // closes that gap too.
            onContextMenu={(e) => e.preventDefault()}
            // Touch only: press-and-hold anywhere on the tile arms a drag after LONG_PRESS_MS,
            // unless it's released early (a tap — handled by the grid's onPointerUp/
            // cancelPendingLongPress above, which lets the Link's own onClick navigate normally) or
            // the finger wanders past tolerance first (a scroll — see the grid's onPointerMove
            // above). Skips presses that started on the always-visible controls, which have their
            // own instant tap behavior. Mouse drags never reach here — they arm instantly from the
            // grip handle instead (see its own onPointerDown below).
            onPointerDown={(e) => {
              if (e.pointerType !== 'touch') return;
              if ((e.target as HTMLElement).closest('.channel-tile__controls, .channel-tile__handle')) return;
              // Tells iOS not to start its own long-press gesture recognizer (link callout /
              // text-selection loupe) here at all, rather than fighting it with CSS after the fact
              // — that's what let text selection sneak in and visually fight the drag ghost.
              // touch-action: pan-y (see the CSS) keeps real scrolling working independently of
              // this, since panning is governed by that property rather than by preventDefault.
              e.preventDefault();
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
                whole tile itself is the long-press target instead. Arms the SAME drag machinery as
                the touch long-press, immediately (no hold delay) — grabbing the handle is already
                the deliberate "I want to drag" signal, so there's no scroll-vs-drag ambiguity to
                wait out the way there is for an anywhere-on-tile touch gesture. */}
            <button
              type="button"
              className="channel-tile__handle"
              title="Drag to reorder"
              aria-label={`Reorder ${channel.name}`}
              onPointerDown={(e) => {
                if (e.pointerType !== 'mouse') return;
                e.preventDefault();
                const wrapEl = e.currentTarget.closest<HTMLElement>('.channel-tile-wrap');
                if (wrapEl) armDrag(e.pointerId, channel.id, wrapEl, e.clientX, e.clientY);
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

      {/* Floating drag ghost — the ONLY visible representation of the tile being dragged, for
          either input method. position:fixed roots it in viewport coordinates (the same space
          getBoundingClientRect and clientX/clientY already use), seeded once from where the tile
          actually sat when the drag armed (origin) plus the live pointer delta (touchOffset) —
          completely independent of wherever CSS Grid auto-places the tile's own (hidden) DOM node
          as the reorder preview reshuffles the OTHER tiles around it. That independence, plus never
          handing rendering off to the browser's own (uncontrollable, throttled) native drag image,
          is what keeps this smooth on both mouse and touch: previously mouse dragging used native
          HTML5 DnD instead of this ghost, and the browser's own dragover/dragenter throttling was
          the actual source of the reported desktop jutter. */}
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
