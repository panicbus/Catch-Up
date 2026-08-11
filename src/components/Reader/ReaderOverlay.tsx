import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useSearchParams } from 'react-router-dom';
import { fetchReaderContent, RateLimitError } from '../../services/api';
import { formatTimeUntil } from '../../services/formatters';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ReaderBlocks } from './ReaderBlocks';
import type { ReaderContent, ReaderResponse } from '../../../ipc-contract';
import './ReaderOverlay.css';

// Same guard as every other web-only component (AccountMenu.tsx, AuthGate.tsx, ...) — desktop has
// no server route for this at all. Structurally redundant with NewsCard.tsx's own isWeb-gated
// eligibility check (nothing on desktop ever sets the `read` param that mounts this), kept anyway
// to match this codebase's established belt-and-suspenders instinct for platform checks.
const isWeb = typeof window !== 'undefined' && !window.api;

// Same constant/reasoning as AuthGate.tsx's identical notice: only worth showing once a wait has
// gone on long enough to plausibly be Render's free-tier cold start, so a warm backend never
// flashes it.
const COLD_START_NOTICE_DELAY_MS = 2500;

type ReaderUnavailableReason = Extract<ReaderResponse, { ok: false }>['reason'];

const REASON_COPY: Record<ReaderUnavailableReason, string> = {
  paywalled: 'This is a subscriber-only story.',
  blocked: "This publisher doesn't allow in-app reading.",
  unsupported: "This link can't be previewed here.",
  'too-short': "Couldn't pull a readable version of this story.",
  failed: 'This story is not available to read on Catch Up. Visit the site instead.',
  busy: 'The reader is busy right now — try again in a moment.',
};

/** What NewsCard.tsx already knows about the story before the fetch even starts — passed through
 * router state (see its "Read here" handler) so the header never renders blank while loading, and
 * so "Open original ↗" and the failure panel's snippet are available immediately, not only after a
 * round trip. All optional: a deep-linked or refreshed `?read=` URL has no router state to draw on
 * and falls back to showing nothing until the real fetch resolves. */
interface CardHint {
  title?: string;
  source?: string;
  imageUrl?: string | null;
  snippet?: string | null;
  url?: string;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'success'; data: ReaderContent }
  | { phase: 'unavailable'; reason: ReaderUnavailableReason }
  | { phase: 'rate-limited'; resetsAt: string | undefined };

function Skeleton() {
  return (
    <div className="reader-overlay__skeleton" aria-hidden="true">
      <div className="reader-overlay__skeleton-line" style={{ width: '100%' }} />
      <div className="reader-overlay__skeleton-line" style={{ width: '92%' }} />
      <div className="reader-overlay__skeleton-line" style={{ width: '96%' }} />
      <div className="reader-overlay__skeleton-line" style={{ width: '70%' }} />
    </div>
  );
}

function Fallback({
  message,
  snippet,
  url,
  source,
}: {
  message: string;
  snippet?: string | null;
  url?: string;
  source?: string;
}) {
  return (
    <div className="reader-overlay__fallback">
      <p className="reader-overlay__fallback-message">{message}</p>
      {snippet && <p className="reader-overlay__fallback-snippet">{snippet}</p>}
      {url && (
        <a className="reader-overlay__fallback-link" href={url} target="_blank" rel="noopener noreferrer">
          Open original{source ? ` on ${source}` : ''} ↗
        </a>
      )}
    </div>
  );
}

function ReaderOverlayInner() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const articleId = searchParams.get('read');
  const channelId = searchParams.get('readChannel');
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [showColdStart, setShowColdStart] = useState(false);

  const close = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('read');
    next.delete('readChannel');
    // Not navigate(-1): a deep-linked or refreshed `?read=` URL may have nothing to go back TO
    // inside the app, and (-1) could exit the PWA entirely. Removing the params directly always
    // lands on the same page with the reader closed.
    // replace: true is load-bearing, not cosmetic — without it this PUSHES a new history entry
    // on top of the one "Read here" already pushed to open the reader. That leaves the opened
    // (`?read=X`) entry sitting one step further back in history, so a single subsequent press of
    // the phone's real back button doesn't exit to wherever the user was before opening the story —
    // it resurrects that stale entry and reopens the same story, re-running the fetch (confirmed
    // live as an infinite reopen loop on stories that fail to load). Replacing collapses the "open"
    // entry in place instead of leaving it behind, so back always exits forward, never back into it.
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!articleId || !channelId) return;
    let cancelled = false;
    setState({ phase: 'loading' });
    setShowColdStart(false);
    fetchReaderContent(articleId, channelId)
      .then((res) => {
        if (cancelled) return;
        setState(res.ok ? { phase: 'success', data: res } : { phase: 'unavailable', reason: res.reason });
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof RateLimitError) setState({ phase: 'rate-limited', resetsAt: e.resetsAt });
        else setState({ phase: 'unavailable', reason: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [articleId, channelId]);

  useEffect(() => {
    if (state.phase !== 'loading') return;
    const timer = window.setTimeout(() => setShowColdStart(true), COLD_START_NOTICE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state.phase, articleId]);

  // Body scroll lock — nothing else in the app does this (Modal.tsx relies on its overlay being
  // the only scrollable thing on top), but without it the feed underneath scrolls along with the
  // overlay on iOS, which is exactly the "smooth scrolling matters everywhere" problem from
  // earlier in this app's history repeating itself in a new place.
  useEffect(() => {
    if (!articleId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [articleId]);

  useEffect(() => {
    if (!articleId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [articleId, close]);

  if (!articleId || !channelId) return null;

  const hint = (location.state ?? {}) as CardHint;
  const originalUrl = state.phase === 'success' ? state.data.url : hint.url;
  const sourceLabel = state.phase === 'success' ? state.data.source : hint.source;

  return createPortal(
    <ErrorBoundary
      fallback={() => (
        <div className="reader-overlay">
          <div className="reader-overlay__topbar">
            <button type="button" className="reader-overlay__close" onClick={close} aria-label="Close">
              ←
            </button>
            <div className="reader-overlay__source">{sourceLabel}</div>
            <div className="reader-overlay__topbar-spacer" />
          </div>
          <div className="reader-overlay__scroll">
            <Fallback message="Something went wrong showing this story." url={originalUrl} source={sourceLabel} />
          </div>
        </div>
      )}
    >
      <div className="reader-overlay" role="dialog" aria-modal="true" aria-label={hint.title || sourceLabel || 'Story'}>
        <div className="reader-overlay__topbar">
          <button type="button" className="reader-overlay__close" onClick={close} aria-label="Close">
            ←
          </button>
          <div className="reader-overlay__source">{sourceLabel}</div>
          {originalUrl ? (
            <a
              className="reader-overlay__open-original"
              href={originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open original${sourceLabel ? ` on ${sourceLabel}` : ''}`}
              title="Open original"
            >
              ↗
            </a>
          ) : (
            <div className="reader-overlay__topbar-spacer" />
          )}
        </div>

        <div className="reader-overlay__scroll">
          {state.phase === 'loading' && (
            <div className="reader-overlay__loading">
              {hint.imageUrl && <img className="reader-overlay__hero" src={hint.imageUrl} alt="" referrerPolicy="no-referrer" />}
              {hint.title && <h1 className="reader-overlay__title">{hint.title}</h1>}
              <Skeleton />
              {showColdStart && (
                <p className="reader-overlay__cold-start">Waking up the server. This can take up to 30 seconds on the first load.</p>
              )}
            </div>
          )}

          {state.phase === 'success' && (
            <article className="reader-overlay__article">
              {state.data.leadImageUrl && (
                <img className="reader-overlay__hero" src={state.data.leadImageUrl} alt="" referrerPolicy="no-referrer" />
              )}
              <h1 className="reader-overlay__title">{state.data.title}</h1>
              <div className="reader-overlay__byline">
                {state.data.byline ? `${state.data.byline} · ` : ''}
                {state.data.source}
              </div>
              {state.data.partial && (
                <p className="reader-overlay__notice">
                  This looks like a preview — the full story may be behind a subscription.
                </p>
              )}
              <div className="reader-overlay__body">
                <ReaderBlocks blocks={state.data.blocks} />
              </div>
              <a className="reader-overlay__continue" href={state.data.url} target="_blank" rel="noopener noreferrer">
                {state.data.truncated ? 'Continue' : 'Read'} on {state.data.source} ↗
              </a>
            </article>
          )}

          {state.phase === 'unavailable' && (
            <Fallback message={REASON_COPY[state.reason]} snippet={hint.snippet} url={originalUrl} source={sourceLabel} />
          )}

          {state.phase === 'rate-limited' && (
            <Fallback
              message={`You've opened a lot of stories today — resets in ${formatTimeUntil(state.resetsAt ?? '')}.`}
              snippet={hint.snippet}
              url={originalUrl}
              source={sourceLabel}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>,
    document.body
  );
}

/** Mounted once in AppShell.tsx, inside AuthGate/OnboardingGate, above <Outlet /> — serves Channel,
 * Pool, Bookmarks and Roll-the-Dice from one instance. Driven entirely by the `read`/`readChannel`
 * search params on whatever route is current (see NewsCard.tsx), not a route of its own, so opening
 * and closing a story never unmounts the feed underneath — scroll position and feed state survive,
 * and the phone's back gesture closes it because it's a real history entry. */
export function ReaderOverlay() {
  if (!isWeb) return null;
  return <ReaderOverlayInner />;
}
