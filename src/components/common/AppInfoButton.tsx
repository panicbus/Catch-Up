import { useState } from 'react';
import { Modal } from './Modal';
import './AppInfoButton.css';

// The real public URL, not window.location.href — on desktop that's a bundled asset path with
// nothing to share, and on web a deep-linked channel path isn't what "share this website" means.
const SHARE_URL = 'https://usecatchup.app';

/** Noticeably bigger than StreakCard's own info icon (13px, currentColor) and a literal black
 * regardless of theme, per explicit direction — matches Logo.tsx's own hardcoded #1a1a1a bottle
 * outline, which already ignores theme the same way. */
function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="#1a1a1a" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" />
      <path d="M10 9v4.7" strokeLinecap="round" />
      <circle cx="10" cy="6" r="1" fill="#1a1a1a" stroke="none" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 11.5a3.2 3.2 0 0 0 4.6.2l2-2a3.2 3.2 0 0 0-4.6-4.6l-1.1 1.1" />
      <path d="M11.5 8.5a3.2 3.2 0 0 0-4.6-.2l-2 2a3.2 3.2 0 0 0 4.6 4.6l1.1-1.1" />
    </svg>
  );
}

// The familiar "box with an arrow out the top" share glyph (iOS's own share-sheet icon), in the
// same stroke style as LinkIcon so the two read as siblings.
function ShareIcon() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.8v9" />
      <path d="M6.7 6.1 10 2.8l3.3 3.3" />
      <path d="M4.5 9.5v6a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-6" />
    </svg>
  );
}

// Feature-detected, not device-detected: the Web Share API is what actually determines whether
// there's a native OS share sheet to hand off to, and that's true for essentially every mobile
// browser (the "for mobile" ask) without misfiring on a merely-narrow desktop window, or missing a
// desktop browser (Edge/Chrome on Windows) that also happens to support it.
const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function AppInfoModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({ title: 'Catch Up', text: 'Your news. Your pace. All caught up.', url: SHARE_URL });
      } catch (e) {
        // AbortError: the user closed the share sheet without picking anything — not a failure.
        if (e instanceof Error && e.name !== 'AbortError') console.error('[AppInfoButton] native share failed', e);
      }
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(SHARE_URL);
      } else {
        // Older/non-secure-context fallback — no navigator.clipboard at all (e.g. plain http).
        const el = document.createElement('textarea');
        el.value = SHARE_URL;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('[AppInfoButton] clipboard write failed', e);
    }
  };

  return (
    <Modal title="About Catch Up" onClose={onClose} centerTitle contentClassName="app-info-modal">
      <p className="app-info-modal__intro">
        Catch Up is a personal news reader that pulls your topics into simple, readable channels
        with no infinite feed and no algorithm deciding what you see. Open it, catch up, and close
        it.
      </p>
      <p className="app-info-modal__credit">Created by Nico Crisafulli with Claude Code in Alameda, CA</p>
      <p className="app-info-modal__copyright">© 2026 Catch Up</p>
      <div className="app-info-modal__links">
        <a
          href="https://ko-fi.com/nicocrisafulli"
          target="_blank"
          rel="noopener noreferrer"
          className="app-info-modal__link"
        >
          Buy me a coffee
        </a>
        <button type="button" className="app-info-modal__link app-info-modal__share" onClick={handleShare}>
          {canNativeShare ? <ShareIcon /> : <LinkIcon />}
          {copied ? 'Link copied' : 'Share this website with a friend'}
        </button>
      </div>
    </Modal>
  );
}

/** The little (i) mark next to the brand mark — Sidebar.tsx (desktop, beside the logo) and
 * HomePage.tsx's mobile top bar (opposite the logo) both mount this same component rather than
 * duplicating the open/close state and modal markup twice. */
export function AppInfoButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="app-info-button" aria-label="About Catch Up" onClick={() => setOpen(true)}>
        <InfoIcon />
      </button>
      {open && <AppInfoModal onClose={() => setOpen(false)} />}
    </>
  );
}
