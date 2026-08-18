import { useState, type ReactNode } from 'react';
import './SettingsAccordion.css';

/** Same chevron used throughout Settings (RollTheDiceSettings, ChannelManageList) — rotates open. */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

interface SettingsAccordionProps {
  label: string;
  /** Right-aligned small text next to the label, e.g. "3 of 8 included". */
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A collapsible, indented box — RollTheDiceSettings' original box, extracted so DigestSetting and
 * TrustedSourcesSetting can look and behave identically instead of each hand-rolling their own
 * chevron/grid-rows-accordion pair. No JS height measuring: the body's grid-template-rows tween
 * (0fr -> 1fr) is the same trick used elsewhere in this app (NewsCard's expand, NewsFeed's read
 * archive). */
export function SettingsAccordion({ label, subtitle, defaultOpen = false, children }: SettingsAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="settings-accordion">
      <button type="button" className="settings-accordion__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronIcon open={open} />
        <span className="settings-accordion__label">{label}</span>
        {subtitle && <span className="settings-accordion__subtitle">{subtitle}</span>}
      </button>
      <div className={`settings-accordion__body ${open ? 'settings-accordion__body--open' : ''}`}>
        <div className="settings-accordion__body-inner">{children}</div>
      </div>
    </div>
  );
}
