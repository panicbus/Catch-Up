import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { getCustomSources, addCustomSource, deleteCustomSource, retryCustomSource } from '../../services/api';
import { relativeTime } from '../../services/formatters';
import { Button } from '../common/Button';
import { SettingsAccordion } from './SettingsAccordion';
import { CURATED_SOURCES, type CuratedSource } from '../../data/curatedSources';
import type { AddCustomSourceResult, CustomSource } from '../../../ipc-contract';
import './CustomSourcesSetting.css';

// Below this, matching is more likely to surface noise than anything the user meant (e.g. a single
// "n" would match dozens of names) than to actually help.
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 8;

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
  // Separate from `draft` itself: closing the list (blur, Escape, after picking one) shouldn't
  // depend on clearing what's typed, and re-focusing a still-matching draft should reopen it.
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  useEffect(() => {
    getCustomSources()
      .then(setSources)
      .catch(() => setSources([])); // a failed initial load reads as "no sources yet" rather than stuck loading forever
  }, []);

  // Substring, not prefix-only — "Times" should surface both "The New York Times" and "The Los
  // Angeles Times", which a typical user is just as likely to type as the leading word.
  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (q.length < MIN_QUERY_LENGTH) return [];
    return CURATED_SOURCES.filter((s) => s.name.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
  }, [draft]);

  // Takes an explicit URL rather than always reading `draft` — selectSuggestion below calls this
  // right after setDraft(source.url), and setDraft doesn't take effect in time for this same
  // function call to read it back via the `draft` closure (state updates are queued, not
  // synchronous), so it would submit whatever was typed a moment ago instead of the picked source.
  const addSource = async (explicitUrl?: string) => {
    const url = (explicitUrl ?? draft).trim();
    if (!url || adding) return;
    setSuggestionsOpen(false);
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

  // One tap is the whole point — a curated pick is a known-good homepage (see curatedSources.ts),
  // so there's nothing to double-check before submitting it the same way a manually-typed URL is.
  const selectSuggestion = (source: CuratedSource) => {
    setHighlightIndex(-1);
    setDraft(source.url);
    void addSource(source.url);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestionsOpen && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === 'Escape') {
        setSuggestionsOpen(false);
        setHighlightIndex(-1);
        return;
      }
      if (e.key === 'Enter' && highlightIndex >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightIndex]);
        return;
      }
    }
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
        they actually fit, the same way every other source already works. Start typing a
        well-known publisher's name to pick it from the list, or paste any site's address directly
        — you don't need to include "https://" or "www.".
      </p>

      <div className="custom-sources__add-row-wrap">
        <div className="custom-sources__add-row">
          <input
            className="custom-sources__input"
            type="text"
            inputMode="url"
            placeholder="Paste a web address, or start typing a name…"
            value={draft}
            onChange={(e) => {
              const value = e.target.value;
              setDraft(value);
              setHighlightIndex(-1);
              setSuggestionsOpen(value.trim().length >= MIN_QUERY_LENGTH);
            }}
            onFocus={() => {
              if (draft.trim().length >= MIN_QUERY_LENGTH) setSuggestionsOpen(true);
            }}
            // No delay needed: every suggestion button below stops mousedown from moving focus at
            // all (see its own onMouseDown), so by the time a real blur fires here, it's a genuine
            // "left the field" and closing immediately is correct, not a race with the click.
            onBlur={() => setSuggestionsOpen(false)}
            onKeyDown={onKeyDown}
            disabled={adding}
            aria-label="Add a news source"
            role="combobox"
            aria-expanded={suggestionsOpen && suggestions.length > 0}
            aria-autocomplete="list"
          />
          <Button variant="primary" onClick={() => void addSource()} disabled={!draft.trim() || adding}>
            {adding ? 'Checking…' : 'Add'}
          </Button>
        </div>
        {suggestionsOpen && suggestions.length > 0 && (
          <ul className="custom-sources__suggestions" role="listbox">
            {suggestions.map((source, i) => (
              <li key={source.url}>
                <button
                  type="button"
                  className={`custom-sources__suggestion ${i === highlightIndex ? 'custom-sources__suggestion--highlighted' : ''}`}
                  role="option"
                  aria-selected={i === highlightIndex}
                  // Keeps focus in the input instead of moving it to this button — the standard
                  // combobox trick that makes onBlur above safe to fire with no delay at all.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(source)}
                  onMouseEnter={() => setHighlightIndex(i)}
                >
                  {source.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {addError && <p className="custom-sources__add-error">{addError}</p>}

      {sources && sources.length > 0 && (
        <SettingsAccordion label="Your sources" subtitle={`${sources.length}`}>
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
        </SettingsAccordion>
      )}
    </div>
  );
}

export function CustomSourcesSetting() {
  if (!isWeb) return null;
  return <CustomSourcesSettingInner />;
}
