import { useEffect, useState, type KeyboardEvent } from 'react';
import { getCustomSources, addCustomSource, deleteCustomSource, retryCustomSource } from '../../services/api';
import { relativeTime } from '../../services/formatters';
import { Button } from '../common/Button';
import type { AddCustomSourceResult, CustomSource } from '../../../ipc-contract';
import './CustomSourcesSetting.css';

// Same guard as every other web-only settings section (AccountSection.tsx) — custom sources are
// stored server-side against a signed-in account, with no desktop equivalent (see
// src/services/api.ts's own comment on why these calls live outside CatchUpApi entirely).
const isWeb = typeof window !== 'undefined' && !window.api;

// Mirrors server/customSources/discover.ts's own reasons exactly — one message per outcome, plain
// language, matching this app's established "never leave a failure unexplained" convention (the
// reader view's own REASON_COPY is the closest precedent). Never says *why* a URL was rejected as
// invalid (no "resolves to a private address") — same reasoning as that copy staying vague there.
const ERROR_COPY: Record<Exclude<AddCustomSourceResult, { ok: true }>['reason'], string> = {
  'invalid-url': "That doesn't look like a public website address.",
  'not-found':
    "Couldn't find a news feed at that address. If you know the site's direct feed link (often something like example.com/feed or example.com/rss), try pasting that instead.",
  unreachable: "Couldn't reach that address right now. Double-check the URL and try again.",
  empty: 'Found a feed there, but it’s empty right now — nothing to add yet.',
  duplicate: 'You’ve already added this source.',
  'limit-reached': 'You can add up to 10 sources — remove one to add another.',
};

function CustomSourcesSettingInner() {
  const [sources, setSources] = useState<CustomSource[] | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => {
    getCustomSources()
      .then(setSources)
      .catch(() => setSources([])); // a failed initial load reads as "no sources yet" rather than stuck loading forever
  }, []);

  const addSource = async () => {
    const url = draft.trim();
    if (!url || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const result = await addCustomSource(url);
      if (result.ok) {
        setSources((prev) => [...(prev ?? []), result.source]);
        setDraft('');
      } else {
        setAddError(ERROR_COPY[result.reason]);
      }
    } catch {
      setAddError('Something went wrong adding that source — try again.');
    } finally {
      setAdding(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void addSource();
    }
  };

  const removeSource = (id: string) => {
    const prev = sources;
    setSources((cur) => (cur ?? []).filter((s) => s.id !== id));
    deleteCustomSource(id).catch(() => setSources(prev)); // roll back on failure
  };

  const retrySource = async (id: string) => {
    setRetryingId(id);
    try {
      await retryCustomSource(id);
      const fresh = await getCustomSources();
      setSources(fresh);
    } catch {
      // Leave the row exactly as it was — the next scheduled round will still pick it up
      // eventually even if this on-demand retry itself failed to reach the server.
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="custom-sources">
      <p className="custom-sources__hint">
        Add a news site's own feed and its stories will be sorted into whichever of your channels
        they actually fit, the same way every other source already works.
      </p>

      <div className="custom-sources__add-row">
        <input
          className="custom-sources__input"
          type="text"
          inputMode="url"
          placeholder="Paste a site's web address…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={adding}
          aria-label="Add a news source"
        />
        <Button variant="primary" onClick={addSource} disabled={!draft.trim() || adding}>
          {adding ? 'Checking…' : 'Add'}
        </Button>
      </div>
      {addError && <p className="custom-sources__add-error">{addError}</p>}

      {sources && sources.length > 0 && (
        <div className="custom-sources__list">
          {sources.map((source) => (
            <div key={source.id} className="custom-sources__row">
              <div className="custom-sources__row-main">
                <span className="custom-sources__row-label">{source.label}</span>
                <span className="custom-sources__row-url">{source.siteUrl}</span>
                {source.disabledAt ? (
                  <span className="custom-sources__row-status custom-sources__row-status--error">
                    Couldn’t check this source recently{source.lastError ? ` (${source.lastError})` : ''}.
                  </span>
                ) : source.lastFetchedAt ? (
                  <span className="custom-sources__row-status">Checked {relativeTime(source.lastFetchedAt)}</span>
                ) : (
                  <span className="custom-sources__row-status">Not checked yet</span>
                )}
              </div>
              <div className="custom-sources__row-actions">
                {source.disabledAt && (
                  <Button variant="ghost" size="sm" onClick={() => retrySource(source.id)} disabled={retryingId === source.id}>
                    {retryingId === source.id ? 'Retrying…' : 'Retry'}
                  </Button>
                )}
                <Button variant="danger" size="sm" onClick={() => removeSource(source.id)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CustomSourcesSetting() {
  if (!isWeb) return null;
  return <CustomSourcesSettingInner />;
}
