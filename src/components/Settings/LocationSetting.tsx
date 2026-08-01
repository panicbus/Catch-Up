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
  const [text, setText] = useState(settings.homeLocation?.query ?? '');
  const [status, setStatus] = useState<'idle' | 'checking' | 'not-found'>('idle');

  const save = async () => {
    const query = text.trim();
    if (!query) {
      update({ homeLocation: null });
      setStatus('idle');
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
  };

  const clear = () => {
    setText('');
    update({ homeLocation: null });
    setStatus('idle');
  };

  return (
    <div className="location-setting">
      <p className="location-setting__hint">
        To prioritize stories closer to you in niche topic channels. Doesn’t affect broad category
        channels (i.e. “Politics” or “Tech”).
      </p>
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
        />
        <Button size="sm" onClick={() => void save()} disabled={status === 'checking'}>
          {status === 'checking' ? 'Checking…' : 'Save'}
        </Button>
        {settings.homeLocation && (
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      {status === 'not-found' && (
        <p className="location-setting__error">
          City not found — try “City, State” or “City, Country”.
        </p>
      )}
      {status === 'idle' && settings.homeLocation && (
        <p className="location-setting__confirm">Set to: {settings.homeLocation.label}</p>
      )}
    </div>
  );
}
