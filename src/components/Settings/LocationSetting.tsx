import { useRef, useState } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { useSettleFieldOnLoad } from '../../hooks/useSettleFieldOnLoad';
import { api } from '../../services/api';
import { Button } from '../common/Button';
import './LocationSetting.css';

/** Your home city, used to deprioritize far-away local stories in topic/entity channels (e.g. a
 * "Wildfires" channel showing a small distant town's fire story) — never in broad category
 * channels like Politics or Tech. Resolved against a bundled city list on save so we always store a
 * real lat/lon, not just free text. */
export function LocationSetting() {
  const { settings, update, loading } = useSettings();
  // Starts in edit mode, matching the "nothing set yet" case — but this is a GUESS made before
  // useSettings' own fetch has resolved (it starts from an empty fallback; see useSettings.ts), not
  // a read of the real saved value. See useSettleFieldOnLoad's own comment for the bug this corrects
  // once loading actually finishes, and why it backs off if the field's already been typed into.
  const [editing, setEditing] = useState(!settings.homeLocation);
  const [text, setText] = useState(settings.homeLocation?.query ?? '');
  const [status, setStatus] = useState<'idle' | 'checking' | 'not-found'>('idle');
  const hasInteractedRef = useRef(false);
  useSettleFieldOnLoad(loading, hasInteractedRef.current, () => {
    setEditing(!settings.homeLocation);
    setText(settings.homeLocation?.query ?? '');
  });

  const save = async () => {
    const query = text.trim();
    if (!query) {
      await update({ homeLocation: null });
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
    // Stays in the 'checking' state (button still says "Checking…") until the save has actually
    // round-tripped to the server, not just landed in local state — closing the app right after
    // seeing "Currently set to: ..." appear is a real workflow, and a force-close (unlike a graceful
    // quit) can abort a still-in-flight request with nothing left behind to retry it.
    await update({ homeLocation: { query, ...resolved } });
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

      {/* Nothing decidable until the real settings land: `editing` is seeded from an empty fallback
          (see useSettleFieldOnLoad above), so rendering during that window flashes the "no location
          set" input for an instant before swapping to the saved value. A blank placeholder line
          holds the space instead, so the section doesn't resize either. */}
      {loading ? (
        <p className="location-setting__confirm" aria-hidden="true">
          &nbsp;
        </p>
      ) : !editing && settings.homeLocation ? (
        <p className="location-setting__confirm">
          Currently set to: <strong className="location-setting__value">{settings.homeLocation.label}</strong>{' '}
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
                hasInteractedRef.current = true;
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
