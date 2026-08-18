import { useState } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { useChannels } from '../../hooks/useChannels';
import { useAiConfig } from '../../hooks/useAiConfig';
import { Button } from '../common/Button';
import { SettingsAccordion } from './SettingsAccordion';
import { ChannelChecklist } from './ChannelChecklist';
import type { AppSettings } from '../../../ipc-contract';
import './DigestSetting.css';

// Same guard every other web-only settings section uses (CustomSourcesSetting.tsx) — the digest
// is sent by a scheduled job against the hosted database, which a desktop-only account has no row
// in at all.
const isWeb = typeof window !== 'undefined' && !window.api;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
}
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Modern engines only (Chrome/Edge/Safari 17+, Node 18+) — falls back to a plain text field
// pre-filled with the auto-detected zone when unavailable, rather than blocking on it.
const SUPPORTED_TIMEZONES: string[] | null =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : null;

function DigestSettingInner() {
  const { settings, update } = useSettings();
  const { channels } = useChannels();
  const { config: aiConfig, setProvider } = useAiConfig();
  const [emailDraft, setEmailDraft] = useState(settings.digestEmailOverride ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  // Closed by default — clicking "Turn on" forces it open (see enable() below) since that's
  // exactly the moment there's something worth looking at; toggling it after that is otherwise
  // just the accordion's own normal open/close, via onOpenChange.
  const [detailsOpen, setDetailsOpen] = useState(false);

  const enable = () => {
    const updates: Partial<AppSettings> = { digestEnabled: true };
    // Only fills these in the FIRST time digest is turned on — re-enabling after a later "turn
    // off" keeps whatever the user already configured rather than resetting it.
    if (!settings.digestTimezone) updates.digestTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (settings.digestChannelIds.length === 0 && channels.length > 0) {
      updates.digestChannelIds = channels.map((c) => c.id);
    }
    update(updates);
    // The recap needs AI configured to actually write anything — turning the digest on also turns
    // on AI filtering (using the app's shared free Gemini key) if it isn't already, rather than
    // making this a second thing to go find in Settings.
    if (aiConfig.provider === null) setProvider('gemini');
    setDetailsOpen(true);
  };

  const toggleChannel = (channelId: string) => {
    const included = settings.digestChannelIds.includes(channelId);
    update({
      digestChannelIds: included
        ? settings.digestChannelIds.filter((id) => id !== channelId)
        : [...settings.digestChannelIds, channelId],
    });
  };

  const saveEmail = () => {
    const trimmed = emailDraft.trim();
    if (trimmed && !EMAIL_PATTERN.test(trimmed)) {
      setEmailError("That doesn't look like a valid email address.");
      return;
    }
    setEmailError(null);
    update({ digestEmailOverride: trimmed || null });
  };

  return (
    <div className="digest-setting">
      <div className="digest-setting__row">
        <span className="digest-setting__label-title">
          Daily digest
          <span className={`digest-setting__badge ${settings.digestEnabled ? 'digest-setting__badge--on' : ''}`}>
            {settings.digestEnabled ? 'On' : 'Off'}
          </span>
        </span>
        <Button
          variant={settings.digestEnabled ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => (settings.digestEnabled ? update({ digestEnabled: false }) : enable())}
        >
          {settings.digestEnabled ? 'Turn off' : 'Turn on'}
        </Button>
      </div>

      <p className="digest-setting__hint">
        A short written recap, plus your top stories from each channel below, sent once a day.
      </p>

      {settings.digestEnabled && (
        <SettingsAccordion label="Digest details" open={detailsOpen} onOpenChange={setDetailsOpen}>
          <div className="digest-setting__body">
            <div className="digest-setting__field">
              <label className="digest-setting__field-label" htmlFor="digest-hour">
                Send at
              </label>
              <div className="digest-setting__time-row">
                <select
                  id="digest-hour"
                  className="digest-setting__select"
                  value={settings.digestSendHour}
                  onChange={(e) => update({ digestSendHour: Number(e.target.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                {SUPPORTED_TIMEZONES ? (
                  <select
                    className="digest-setting__select"
                    value={settings.digestTimezone ?? ''}
                    onChange={(e) => update({ digestTimezone: e.target.value })}
                    aria-label="Time zone"
                  >
                    {settings.digestTimezone && !SUPPORTED_TIMEZONES.includes(settings.digestTimezone) && (
                      <option value={settings.digestTimezone}>{settings.digestTimezone}</option>
                    )}
                    {SUPPORTED_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="digest-setting__input digest-setting__input--tz"
                    type="text"
                    value={settings.digestTimezone ?? ''}
                    onChange={(e) => update({ digestTimezone: e.target.value })}
                    aria-label="Time zone (IANA name, e.g. America/Los_Angeles)"
                  />
                )}
              </div>
            </div>

            <div className="digest-setting__field">
              <span className="digest-setting__field-label">Channels included</span>
              <ChannelChecklist
                channels={channels}
                isChecked={(id) => settings.digestChannelIds.includes(id)}
                onToggle={toggleChannel}
                emptyLabel="Add a channel first — there's nothing to include yet."
              />
            </div>

            <div className="digest-setting__field">
              <label className="digest-setting__field-label" htmlFor="digest-email">
                Send to a different email (optional — leave blank to use your sign-in email)
              </label>
              <input
                id="digest-email"
                className="digest-setting__input"
                type="email"
                placeholder="you@example.com"
                value={emailDraft}
                onChange={(e) => {
                  setEmailDraft(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                onBlur={saveEmail}
              />
              {emailError && <p className="digest-setting__error">{emailError}</p>}
            </div>
          </div>
        </SettingsAccordion>
      )}
    </div>
  );
}

export function DigestSetting() {
  if (!isWeb) return null;
  return <DigestSettingInner />;
}
