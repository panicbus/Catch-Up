import type { SortMode } from '../../../ipc-contract';
import './SortModeToggle.css';

interface SortModeToggleProps {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}

/** Sibling to ViewModeToggle — a second, independent axis (order, not layout). 'relevance' is
 * server-applied (see NewsFeed's own sortMode handling for why the day headers disappear in that
 * mode), so switching this re-fetches rather than just re-rendering client-side. */
export function SortModeToggle({ value, onChange }: SortModeToggleProps) {
  return (
    <div className="sort-toggle" role="group" aria-label="Sort order">
      <button
        type="button"
        className={`sort-toggle__btn ${value === 'newest' ? 'sort-toggle__btn--active' : ''}`}
        onClick={() => onChange('newest')}
        aria-pressed={value === 'newest'}
      >
        Newest
      </button>
      <button
        type="button"
        className={`sort-toggle__btn ${value === 'relevance' ? 'sort-toggle__btn--active' : ''}`}
        onClick={() => onChange('relevance')}
        aria-pressed={value === 'relevance'}
      >
        Most relevant
      </button>
    </div>
  );
}
