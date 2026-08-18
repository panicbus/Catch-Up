import { useSettings } from '../../hooks/useSettings';
import './MaxStoriesSetting.css';

const OPTIONS = [10, 25, 50, 100] as const;

/** Caps how many unread stories show at once in a channel's main feed (read-stories archive is
 * unaffected). Defaults to 25, so this always shows a real selection out of the box instead of
 * landing on an unlabeled value none of the buttons reflect. */
export function MaxStoriesSetting() {
  const { settings, update } = useSettings();

  return (
    <div className="max-stories-setting">
      <p className="max-stories-setting__hint">
        How many unread stories show at once in a channel. Older stories beyond this are held back
        until you catch up.
      </p>
      <div className="max-stories-setting__options" role="group" aria-label="Stories shown at once">
        {OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            className={`max-stories-setting__btn ${settings.maxStoriesShown === n ? 'max-stories-setting__btn--active' : ''}`}
            onClick={() => update({ maxStoriesShown: n })}
            aria-pressed={settings.maxStoriesShown === n}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
