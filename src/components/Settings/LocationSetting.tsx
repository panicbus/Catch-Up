import { useState } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { api } from '../../services/api';
import { Button } from '../common/Button';
import './LocationSetting.css';

/** Your home city, used to deprioritize far-away local stories in topic/entity channels (e.g. a
 * "Wildfires" channel showing a small distant town's fire story) — never in broad category
 * channels like Politics or Tech. Resolved against a bundled city list on save so we always store a
 * real lat/lon, not just free text. */
export function LocationSetting() {
  const { settings, update } = useSettings();
  // Starts in edit mode when nothing's set yet — there's nothing to "change" from. Once a location
  // exists, this collapses to a plain read display + a "Change location" link that reopens editing.
  const [editing, setEditing] = useState(!settings.homeLocation);
  const [text, setText] = useState(settings.homeLocation?.query ?? '');
  const [status, setStatus] = useState<'idle' | 'checking' | 'not-found'>('idle');

  const save = async () => {
    const query = text.trim();
    if (!query) {
      update({ homeLocation: null });
      setStatus('idle');
      setEditing(true);
      return;
    }
    setStatus('checking');
    const resolved = await api.resolveHomeLocation(query);
    if (!resolved) {
      setStatus('not-found');
      return;
    }
    update({ homeLocation: { query, ...resolved } });
    setStatus('idle');
    setEditing(false);
  };

  const startChange = () => {
    setText(settings.homeLocation?.query ?? '');
    setStatus('idle');
    setEditing(true);
  };

  const cancel = () => {
    setText(settings.homeLocation?.query ?? '');
    setStatus('idle');
    setEditing(false);
  };

  return (
    <div className="location-setting">
      <p className="location-setting__hint">
        To prioritize stories closer to you in niche topic channels. Doesn’t affect broad category
        channels (i.e. “Politics” or “Tech”).
      </p>

      {!editing && settings.homeLocation ? (
        <p className="location-setting__confirm">
          Currently set to: {settings.homeLocation.label}{' '}
          <button type="button" className="location-setting__change-link" onClick={startChange}>
            Change location
          </button>
        </p>
      ) : (
        <>
          <div className="location-setting__row">
            <input
              className="location-setting__input"
              type="text"
              placeholder="City, State/Country (e.g. Alameda, CA)"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (status === 'not-found') setStatus('idle');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
              spellCheck={false}
              autoFocus={!!settings.homeLocation}
            />
            <Button size="sm" onClick={() => void save()} disabled={status === 'checking'}>
              {status === 'checking' ? 'Checking…' : 'Save'}
            </Button>
            {settings.homeLocation && (
              <Button size="sm" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>
          {status === 'not-found' && (
            <p className="location-setting__error">
              City not found — try “City, State” or “City, Country”.
            </p>
          )}
        </>
      )}
    </div>
  );
}
