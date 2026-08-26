import { useState, type KeyboardEvent } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { Button } from '../common/Button';
import { SettingsAccordion } from './SettingsAccordion';
import './TrustedSourcesSetting.css';

/** Accepts a bare domain ("reuters.com"), a full URL, or one with "www." — reduces all three to
 * the same plain hostname relevance.ts actually matches against (see isTrustedSource there).
 * Returns null for something that can't reasonably be a domain at all (empty, no dot). */
function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let host = trimmed;
  try {
    // Accept a pasted full URL by letting URL() do the parsing; a bare domain has no scheme, so
    // prefix one just so URL() accepts it too rather than throwing on the missing "://".
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    /* not URL-shaped at all — fall through and validate the raw text below */
  }
  host = host.toLowerCase().replace(/^www\./, '');
  return host.includes('.') ? host : null;
}

/** Lets the user mark publisher domains as trusted — the Settings-side counterpart to the star
 * toggle on each story card (see TrustToggle.tsx); both write/read the same
 * Settings.trustedSourceDomains array, so a domain trusted here or from a card shows up in both
 * places. A plain Settings field, not its own entity (unlike CustomSourcesSetting's sources, which
 * need server-side feed discovery) — so this uses useSettings().update() directly rather than a
 * dedicated add/remove API. */
export function TrustedSourcesSetting() {
  const { settings, update } = useSettings();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addDomain = () => {
    const domain = normalizeDomain(draft);
    if (!domain) {
      setError("That doesn't look like a domain. Try something like reuters.com.");
      return;
    }
    setError(null);
    if (settings.trustedSourceDomains.includes(domain)) {
      setDraft('');
      return;
    }
    update({ trustedSourceDomains: [...settings.trustedSourceDomains, domain] });
    setDraft('');
  };

  const removeDomain = (domain: string) => {
    update({ trustedSourceDomains: settings.trustedSourceDomains.filter((d) => d !== domain) });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDomain();
    }
  };

  return (
    <div className="trusted-sources-setting">
      <p className="trusted-sources-setting__hint">
        Stories from a trusted source rank a little higher. You can also mark a source trusted
        right from its story card, wherever you see its name.
      </p>

      <div className="trusted-sources-setting__add-row">
        <input
          className="trusted-sources-setting__input"
          type="text"
          inputMode="url"
          placeholder="e.g. reuters.com"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          aria-label="Add a trusted source"
        />
        <Button variant="primary" onClick={addDomain} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {error && <p className="trusted-sources-setting__error">{error}</p>}

      {settings.trustedSourceDomains.length > 0 && (
        <SettingsAccordion label="Trusted" subtitle={`${settings.trustedSourceDomains.length}`}>
          <div className="trusted-sources-setting__list">
            {settings.trustedSourceDomains.map((domain) => (
              <div key={domain} className="trusted-sources-setting__row">
                <span className="trusted-sources-setting__row-label">{domain}</span>
                <Button variant="danger" size="sm" onClick={() => removeDomain(domain)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </SettingsAccordion>
      )}
    </div>
  );
}
