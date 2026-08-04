import type { Subchannel } from '../../../ipc-contract';
import './SubchannelPicker.css';

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
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ManageIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

interface SubchannelPickerTriggerProps {
  subchannels: Subchannel[];
  open: boolean;
  onToggle: () => void;
  /** Opens the subchannel manage panel directly — used only when there are no subchannels to pick
   * between yet (see SubchannelPickerPanel's own doc comment for why that still needs a path in). */
  onManageClick: () => void;
}

/** The compact always-visible pill (lives inline in ChannelPage's controls row). Deliberately split
 * from SubchannelPickerPanel below — the panel needs to render full-width, breaking out of the
 * narrow flex column this trigger sits in, so ChannelPage places the two in different parts of its
 * layout while sharing one `open` state. Always reads "Subchannels (N)", not the active selection —
 * this is the picker itself, not a value display. */
export function SubchannelPickerTrigger({ subchannels, open, onToggle, onManageClick }: SubchannelPickerTriggerProps) {
  const hasSubchannels = subchannels.length > 0;
  return (
    <button
      type="button"
      className="subchannel-picker__trigger"
      onClick={hasSubchannels ? onToggle : onManageClick}
      aria-expanded={hasSubchannels && open}
      aria-label="Subchannels"
    >
      Subchannels{hasSubchannels ? ` (${subchannels.length})` : ''}
      <ChevronIcon open={hasSubchannels && open} />
    </button>
  );
}

interface SubchannelPickerPanelProps {
  subchannels: Subchannel[];
  open: boolean;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  /** Same shape as SubchannelBar's — this is the mobile stand-in for that horizontal pill row,
   * which uses flex-wrap and stacks badly at phone width. Same underlying data either way. */
  counts?: Record<string, number>;
  totalUnread?: number;
  /** Opens the subchannel manage panel — the last item in this accordion (mobile's only access to
   * it; desktop's SubchannelBar keeps its own separate always-visible pill for this). */
  onManageClick: () => void;
}

/** Full-width inline accordion — a phone-width floating menu left too little room either side for
 * what's the main way into a channel's subchannels on mobile, and an overlay doesn't actually make
 * room for itself, it just covers whatever was already there. Rendered by ChannelPage as a full-
 * width sibling of the controls row (like SubchannelManagePanel already is), not nested inside the
 * narrow flex column the trigger lives in — nesting it there would need the panel to force a wrap
 * in an ancestor flex row two levels up, which plain CSS can't do from a descendant. */
export function SubchannelPickerPanel({ subchannels, open, activeId, onSelect, onClose, counts, totalUnread = 0, onManageClick }: SubchannelPickerPanelProps) {
  if (subchannels.length === 0) return null;
  return (
    <div className={`subchannel-picker__panel ${open ? 'subchannel-picker__panel--open' : ''}`}>
      <div className="subchannel-picker__panel-inner">
        <button
          type="button"
          aria-selected={activeId === null}
          className={`subchannel-picker__item ${activeId === null ? 'subchannel-picker__item--active' : ''}`}
          onClick={() => {
            onSelect(null);
            onClose();
          }}
        >
          All
          {totalUnread > 0 && <span className="subchannel-picker__count">{totalUnread}</span>}
        </button>
        {subchannels.map((sub) => {
          const count = counts?.[sub.id] ?? 0;
          return (
            <button
              key={sub.id}
              type="button"
              aria-selected={activeId === sub.id}
              className={`subchannel-picker__item ${activeId === sub.id ? 'subchannel-picker__item--active' : ''}`}
              onClick={() => {
                onSelect(sub.id);
                onClose();
              }}
            >
              {sub.name}
              {count > 0 && <span className="subchannel-picker__count">{count}</span>}
            </button>
          );
        })}
        <div className="subchannel-picker__divider" />
        <button
          type="button"
          className="subchannel-picker__item subchannel-picker__item--manage"
          onClick={() => {
            onClose();
            onManageClick();
          }}
        >
          <ManageIcon />
          Manage subchannels
        </button>
      </div>
    </div>
  );
}
