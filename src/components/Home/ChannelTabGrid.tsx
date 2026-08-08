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
  /** True when this drag was armed by simply touching a tile while rearranging mode was ALREADY on
   * (as opposed to the long-press that turned the mode on in the first place, or any mouse drag).
   * Only those drags can end as a "tap to put everything down" — see finishDrag. */
  armedWhileRearranging: boolean;
}

/** Carries the one thing raw Touch events can't provide but armDrag needs: a real
 * PointerEvent.pointerId, required for setPointerCapture. Written by a tile's onPointerDown the
 * instant a touch lands, read and cleared by the touchstart that follows for that same physical
 * touch (pointerdown precedes touchstart per spec). Deliberately inert — it carries an id and makes
 * no decisions, so it can't become a second opinion about what the gesture means. */
interface TouchPointerHint {
  pointerId: number;
  tileEl: HTMLElement;
  channelId: string;
}

/** The ONE state machine for touches that haven't become a drag yet. Replaces the old
 * PendingLongPress *and* the separate origin tracking the raw magnifier-suppression listener used to
 * keep — those were two independently-sourced trackers (React Pointer Events vs. raw Touch Events)
 * both deciding "hold or scroll?" on their own, which is exactly how they could reach different
 * answers frame to frame and make the gesture feel unreliable.
 *
 * - `hold-watch`: a touch on a tile that may become the long-press that ENTERS rearranging mode.
 * - `tap-watch`:  a touch on the grid's own background while already rearranging, which — if it
 *                 ends without wandering — is the tap that puts everything back down.
 *
 * A touch on a tile while already rearranging appears in neither state: it arms a drag immediately,
 * with no hold to wait out, so dragRef takes ownership of it right away. */
type TouchTrack =
  | {
      kind: 'hold-watch';
      touchId: number;
      pointerId: number;
      channelId: string;
      tileEl: HTMLElement;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      timerId: number;
    }
  | { kind: 'tap-watch'; touchId: number; startX: number; startY: number };

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
//
// Was 420ms / 10px — confirmed live to still false-positive into drag mode on a scroll that starts
// slowly (a real swipe often has near-zero velocity for its first ~100-200ms as the finger commits
// to the gesture, so cumulative movement can still be under 10px right as the old, shorter timer
// fired). Both bumped up to give a genuine scroll more time and more room to clear the tolerance
// before the hold commits, at the cost of a real long-press needing to hold slightly longer/stiller
// — needs on-device confirmation that this actually clears up the false positives without making
// intentional rearranging feel sluggish to trigger.
const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVE_TOLERANCE_PX = 14;

// Applied to document.body (not scoped to this grid — see the raw touch effect's onTouchStart for
// why) for the duration of a touch that might be a long-press, to suppress iOS's native text-
// selection/magnifier gesture. Defined in src/styles/global.css since it targets an element well
// outside this component's own tree.
const NO_SELECT_CLASS = 'catch-up-suppress-select';

export function ChannelTabGrid({ channels, counts }: ChannelTabGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Live translate offset for the tile currently being dragged (mouse or touch alike) — null
  // whenever no drag is in progress. Both input methods share this one floating-ghost rendering
  // path; there is no separate native-HTML5-drag-image path anymore (see armDrag below for why).
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);
  // Touch only: the whole grid is "picked up" — every tile jiggles and shows a drag handle, and any
  // tile can be dragged with a plain touch, no hold required — until a tap puts it back down. See
  // the raw touch effect below for how this turns on/off, and the CSS for the jiggle/handle visuals.
  const [rearranging, setRearranging] = useState(false);
  const dragRef = useRef<DragRef | null>(null);
  const touchPointerHintRef = useRef<TouchPointerHint | null>(null);
  const touchTrackRef = useRef<TouchTrack | null>(null);
  // The raw touch effect's listeners are bound once at mount and read this instead of closing over
  // `rearranging` directly, so a mode change mid-gesture is always seen without re-subscribing.
  const rearrangingRef = useRef(rearranging);
  useEffect(() => {
    rearrangingRef.current = rearranging;
  }, [rearranging]);
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

  // Begins a drag from wherever the pointer currently is — shared by the touch long-press (which
  // both enters rearranging mode AND arms this same drag from the same continuous touch, see the
  // raw touch effect below), any subsequent touch on a tile once already rearranging (armed
  // instantly, no hold), and the desktop grip handle's immediate onPointerDown — every path drives
  // the exact same floating-ghost rendering path. There is deliberately no separate native-HTML5-
  // drag-and-drop branch for mouse: that API's browser-throttled dragover/dragenter delivery and
  // uncontrollable drag image were the actual source of the reported desktop jutter, and can't be
  // tuned away while still using it. Pointer capture is taken on the GRID container (not the tile
  // itself) for the same reason the rest of this file already does — a captured pointer's events
  // stop targeting a DOM node that's been physically repositioned among its siblings, which is
  // exactly what happens once React reorders `ordered` to match the live preview.
  const armDrag = (
    pointerId: number,
    channelId: string,
    tileEl: HTMLElement,
    x: number,
    y: number,
    armedWhileRearranging: boolean
  ) => {
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
      armedWhileRearranging,
    };
    setDrag({ draggingId: channelId, overId: null, baseOrder: slots.map((s) => s.id) });
    setTouchOffset({ x: 0, y: 0 });
    startAutoScroll(gridEl);
  };

  const finishDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = dragRef.current;
    if (!t || e.pointerId !== t.pointerId) return;
    if (t.rafId) cancelAnimationFrame(t.rafId);
    stopAutoScroll();
    t.captureEl.releasePointerCapture(e.pointerId);
    // A drag that (a) was armed by touching a tile while ALREADY rearranging — not the long-press
    // that turned rearranging on in the first place, which must NOT instantly turn it back off on
    // its own release — and (b) never actually moved is the "tap to put everything down" gesture:
    // matches iOS, where tapping an icon while the grid is jiggling dismisses the mode rather than
    // opening it. Read BEFORE dragRef is cleared below. Mouse can never reach this — armedWhileRearranging
    // is only ever set true from the touch continuation path.
    const totalMove = Math.hypot(t.pendingOffset.x, t.pendingOffset.y);
    const isTapToExit = t.armedWhileRearranging && totalMove <= LONG_PRESS_MOVE_TOLERANCE_PX;
    dragRef.current = null;
    // Swallow the click the browser is about to fire right after this pointerup — but only THAT
    // one: self-clears shortly after in case no click ever actually arrives to consume it (some
    // browsers skip the click entirely once a touchmove in the gesture called preventDefault), so a
    // completed drag can never leave this stuck "true" and silently eat the next unrelated tap. Also
    // exactly what stops a tap-to-exit from navigating the Link it landed on — no extra code needed.
    justDraggedRef.current = true;
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 400);
    commitReorder(preview);
    setDrag(null);
    setTouchOffset(null);
    if (isTapToExit) setRearranging(false);
  };

  // Unmounting mid-drag (e.g. navigating away) must not leave a rAF loop or a pending timer running
  // against a gone component — same reasoning as every other rAF/timer cleanup in this app.
  useEffect(() => {
    return () => {
      const t = dragRef.current;
      if (t?.rafId) cancelAnimationFrame(t.rafId);
      if (t?.scrollRafId) cancelAnimationFrame(t.scrollRafId);
      const tr = touchTrackRef.current;
      if (tr?.kind === 'hold-watch') window.clearTimeout(tr.timerId);
      document.body.classList.remove(NO_SELECT_CLASS);
    };
  }, []);

  // THE ONE place that decides what an in-progress touch means, replacing what used to be TWO
  // independently-sourced trackers (React Pointer Events driving a hold timer, plus a separate raw
  // Touch listener applying the same tolerance check on its own just to suppress iOS's magnifier).
  // Two state machines reading two different event streams could — and did, confirmed live — reach
  // different answers about the same gesture frame to frame, which is what made both the magnifier
  // suppression and the scroll-vs-drag call feel inconsistent. Now there is exactly one.
  //
  // Raw (non-React) listeners are required, not a style choice: PointerEvent.preventDefault() does
  // NOT reliably cancel iOS's native long-press text-selection/callout gesture — confirmed live —
  // only preventDefault() on the real underlying TouchEvent does. And this listener must never call
  // it on touchstart or touchend: doing that unconditionally, for every touch landing on a tile, was
  // ALSO confirmed live to break scrolling that starts on a tile until an unrelated tap "resets" it
  // — a real WebKit behavior, not a bug in the reasoning that touch-action: pan-y should make it
  // harmless. So touchmove is the only event this ever calls preventDefault() on, and only within
  // LONG_PRESS_MOVE_TOLERANCE_PX of where a hold started — a real scroll swipe crosses that almost
  // immediately, at which point this stops touching the event and native scrolling takes over
  // exactly as if this listener wasn't here.
  //
  // dragRef.current is the handoff signal: the FIRST line of onTouchMove bails once a drag is live,
  // because from that instant the grid's own onPointerMove (above) owns the gesture completely.
  // There is never a second decision-maker running alongside an active drag.
  //
  // Three things can be true about a touch that hasn't become a drag yet:
  //  - Not rearranging, touch lands on a tile: might become the long-press that turns rearranging
  //    ON (armDrag is called from the SAME continuous touch the instant it fires, so the finger
  //    never has to lift to start dragging — matching iOS).
  //  - Already rearranging, touch lands on a tile: arms a drag immediately, no hold — matches iOS
  //    letting you drag any icon the instant you touch it once already jiggling.
  //  - Already rearranging, touch lands on empty grid background: might be the tap that turns
  //    rearranging back OFF. (The tap-to-exit case for touching a TILE is instead resolved in
  //    finishDrag, since a continuation-armed drag that never moved IS that tap — see there.)
  useEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl) return;

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.channel-tile__controls, .channel-tile__handle')) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const wrapEl = target.closest<HTMLElement>('.channel-tile-wrap');

      if (!wrapEl) {
        // Empty grid background — only matters as a possible tap-to-exit while rearranging.
        if (rearrangingRef.current) {
          touchTrackRef.current = { kind: 'tap-watch', touchId: touch.identifier, startX: touch.clientX, startY: touch.clientY };
        }
        return;
      }

      // Suppresses the magnifier/text-selection for the whole hold, including a perfectly
      // motionless one (which fires no touchmove at all — see NO_SELECT_CLASS's own comment for why
      // that dead spot is exactly what let this slip through before). Applied globally, not just to
      // this tile, since iOS reaches for the nearest SELECTABLE text once the tile itself refuses —
      // confirmed live to land on HomePage's own headings just above the grid otherwise. Removed on
      // touchend/touchcancel below, whichever comes first.
      document.body.classList.add(NO_SELECT_CLASS);

      const channelId = wrapEl.dataset.channelId;
      const hint = touchPointerHintRef.current;
      touchPointerHintRef.current = null;
      // The hint is written by this same tile's onPointerDown a moment earlier in this same event
      // dispatch (pointerdown precedes touchstart for one physical touch, per spec) — if it's
      // missing or points at a different tile, something is off; degrade to doing nothing for this
      // touch rather than guessing, since armDrag needs a real pointerId it would otherwise lack.
      if (!channelId || !hint || hint.tileEl !== wrapEl) return;

      if (rearrangingRef.current) {
        armDrag(hint.pointerId, channelId, wrapEl, touch.clientX, touch.clientY, true);
        return;
      }

      const timerId = window.setTimeout(() => {
        const tr = touchTrackRef.current;
        if (!tr || tr.kind !== 'hold-watch' || tr.touchId !== touch.identifier) return;
        touchTrackRef.current = null;
        setRearranging(true);
        armDrag(tr.pointerId, tr.channelId, tr.tileEl, tr.lastX, tr.lastY, false);
        // Belt-and-suspenders alongside NO_SELECT_CLASS above: clears anything iOS's native
        // selection gesture managed to start in the brief window before that class took effect.
        window.getSelection()?.removeAllRanges();
      }, LONG_PRESS_MS);
      touchTrackRef.current = {
        kind: 'hold-watch',
        touchId: touch.identifier,
        pointerId: hint.pointerId,
        channelId,
        tileEl: wrapEl,
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        timerId,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current) return; // live drag — the grid's onPointerMove owns this touch now.
      const tr = touchTrackRef.current;
      if (!tr) return;
      const touch = [...e.changedTouches].find((t) => t.identifier === tr.touchId);
      if (!touch) return;
      const moved = Math.hypot(touch.clientX - tr.startX, touch.clientY - tr.startY);

      if (tr.kind === 'hold-watch') {
        if (moved > LONG_PRESS_MOVE_TOLERANCE_PX) {
          // Reads as a scroll now — let it go entirely. Nothing further is prevented for this
          // gesture, so native scrolling resumes exactly as if this listener wasn't here.
          window.clearTimeout(tr.timerId);
          touchTrackRef.current = null;
          return;
        }
        tr.lastX = touch.clientX;
        tr.lastY = touch.clientY;
        e.preventDefault();
        return;
      }

      // tap-watch: nothing to suppress off-tile — just stop treating this as a possible tap once
      // it's wandered enough to read as a page pan instead (which stays free to work normally).
      if (moved > LONG_PRESS_MOVE_TOLERANCE_PX) touchTrackRef.current = null;
    };

    const onTouchEnd = (e: TouchEvent) => {
      document.body.classList.remove(NO_SELECT_CLASS);
      const tr = touchTrackRef.current;
      if (!tr || ![...e.changedTouches].some((t) => t.identifier === tr.touchId)) return;
      touchTrackRef.current = null;
      if (tr.kind === 'hold-watch') {
        window.clearTimeout(tr.timerId);
        return;
      }
      // tap-watch ended without ever exceeding tolerance (otherwise onTouchMove would already have
      // cleared it) — this is the deliberate tap that puts everything back down.
      setRearranging(false);
    };

    const onTouchCancel = (e: TouchEvent) => {
      document.body.classList.remove(NO_SELECT_CLASS);
      const tr = touchTrackRef.current;
      if (!tr || ![...e.changedTouches].some((t) => t.identifier === tr.touchId)) return;
      touchTrackRef.current = null;
      if (tr.kind === 'hold-watch') window.clearTimeout(tr.timerId);
      // No exit on cancel — the OS taking the gesture for something else (an incoming call, e.g.)
      // isn't the user's deliberate "done rearranging" tap.
    };

    gridEl.addEventListener('touchstart', onTouchStart, { passive: true });
    gridEl.addEventListener('touchmove', onTouchMove, { passive: false });
    gridEl.addEventListener('touchend', onTouchEnd, { passive: true });
    gridEl.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      gridEl.removeEventListener('touchstart', onTouchStart);
      gridEl.removeEventListener('touchmove', onTouchMove);
      gridEl.removeEventListener('touchend', onTouchEnd);
      gridEl.removeEventListener('touchcancel', onTouchCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      className={`channel-grid ${drag ? 'channel-grid--dragging' : ''} ${rearranging ? 'channel-grid--rearranging' : ''}`}
      // The live drag itself is tracked from HERE, not from the tile that was actually pressed — a
      // captured pointer's events stop targeting a DOM node that's been physically repositioned
      // among its siblings (which is exactly what happens once React reorders `ordered` to match
      // the live preview), so anything bound to the tile itself would silently lose the gesture
      // mid-drag. The grid container never moves, so capturing there survives the reorder. This
      // handles BOTH input methods — mouse drags (armed instantly from the grip handle) and touch
      // drags (armed by the raw touch effect below, either via the long-press that enters
      // rearranging mode or instantly once already rearranging) — since neither branch below checks
      // pointer type. Everything BEFORE a drag is armed (the long-press hold, tap-to-exit) is
      // handled by that raw touch effect instead, not here — see its own file comment for why.
      onPointerMove={(e) => {
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
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
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
            // Touch only. All the actual gesture logic (long-press to enter rearranging, instant
            // arm once already rearranging, tap-to-exit) lives in the raw touch effect below, which
            // needs real Touch events to reliably suppress iOS's magnifier — this handler's only
            // remaining job is handing that effect a real PointerEvent.pointerId (Touch events don't
            // carry one, but armDrag needs one for setPointerCapture), plus suppressing the ~300ms
            // synthetic compatibility mouse events every touch sequence otherwise fires. Skips
            // presses that started on the always-visible controls or the (mobile, rearranging-only)
            // handle, both of which have their own behavior. Mouse never reaches here — it arms
            // instantly from the grip handle instead (see its own onPointerDown below).
            onPointerDown={(e) => {
              if (e.pointerType !== 'touch') return;
              if ((e.target as HTMLElement).closest('.channel-tile__controls, .channel-tile__handle')) return;
              e.preventDefault();
              touchPointerHintRef.current = { pointerId: e.pointerId, tileEl: e.currentTarget, channelId: channel.id };
            }}
          >
            <Link
              className={`channel-tile ${isChannelPaused(channel.pausedUntil) ? 'channel-tile--paused' : ''}`}
              style={{ background: getTileColor(channel.id) }}
              to={`/channel/${channel.slug}`}
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

            {/* Drag handle (top-left). Desktop/mouse: hidden until hover (see CSS), arms the SAME
                drag machinery as touch, immediately (no hold delay) — grabbing the handle is
                already the deliberate "I want to drag" signal, so there's no scroll-vs-drag
                ambiguity to wait out the way there is for an anywhere-on-tile touch gesture.
                Mobile: shown ONLY while rearranging (see CSS), purely as a visual affordance that
                dragging is available — pointer-events:none there lets a touch on it fall straight
                through to .channel-tile-wrap beneath, which is what actually arms the drag (see the
                raw touch effect's continuation-arm branch), so the whole tile stays the grab target,
                not just this icon. */}
            <button
              type="button"
              className="channel-tile__handle"
              title="Drag to reorder"
              aria-label={`Reorder ${channel.name}`}
              onPointerDown={(e) => {
                if (e.pointerType !== 'mouse') return;
                e.preventDefault();
                const wrapEl = e.currentTarget.closest<HTMLElement>('.channel-tile-wrap');
                if (wrapEl) armDrag(e.pointerId, channel.id, wrapEl, e.clientX, e.clientY, false);
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
