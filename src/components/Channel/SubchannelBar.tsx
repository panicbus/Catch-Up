import type { Subchannel } from '../../../ipc-contract';
import './SubchannelBar.css';

interface SubchannelBarProps {
  subchannels: Subchannel[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onManageClick: () => void;
  managing: boolean;
  /** Unread count per subchannel id (see useChannelArticles) — shown as a small badge on each pill. */
  counts?: Record<string, number>;
  /** Channel-wide unread total — shown on the "All" pill. */
  totalUnread?: number;
}

export function SubchannelBar({
  subchannels,
  activeId,
  onSelect,
  onManageClick,
  managing,
  counts,
  totalUnread = 0,
}: SubchannelBarProps) {
  return (
    <div className="subchannel-bar">
      {subchannels.length > 0 && (
        <>
          <button
            type="button"
            className={`subchannel-bar__chip ${activeId === null ? 'subchannel-bar__chip--active' : ''}`}
            onClick={() => onSelect(null)}
          >
            All
            {totalUnread > 0 && <span className="subchannel-bar__chip-count">{totalUnread}</span>}
          </button>
          {subchannels.map((sub) => {
            const count = counts?.[sub.id] ?? 0;
            return (
              <button
                key={sub.id}
                type="button"
                className={`subchannel-bar__chip ${activeId === sub.id ? 'subchannel-bar__chip--active' : ''}`}
                onClick={() => onSelect(sub.id)}
              >
                {sub.name}
                {count > 0 && <span className="subchannel-bar__chip-count">{count}</span>}
              </button>
            );
          })}
        </>
      )}
      <button
        type="button"
        className={`subchannel-bar__manage ${managing ? 'subchannel-bar__manage--active' : ''}`}
        onClick={onManageClick}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          {managing ? (
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          ) : (
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          )}
        </svg>
        {managing ? 'Done' : subchannels.length > 0 ? 'Manage subchannels' : 'Add subchannels'}
      </button>
    </div>
  );
}
