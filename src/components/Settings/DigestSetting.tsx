import { useState } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { useChannels } from '../../hooks/useChannels';
import { useAiConfig } from '../../hooks/useAiConfig';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Button } from '../common/Button';
import { SettingsAccordion } from './SettingsAccordion';
import { ChannelChecklist } from './ChannelChecklist';
import { DigestEmailField } from './DigestEmailField';
import type { AppSettings } from '../../../ipc-contract';
import './DigestSetting.css';

// Same guard every other web-only settings section uses (CustomSourcesSetting.tsx) — the digest
// is sent by a scheduled job against the hosted database, which a desktop-only account has no row
// in at all.
const isWeb = typeof window !== 'undefined' && !window.api;

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
  const { config: aiConfig, loading: aiConfigLoading, setProvider } = useAiConfig();
  const currentUser = useCurrentUser();
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
    // The digest now only ever sends to this field — no more falling back to the sign-in email when
    // it's blank (see server/cron/digest.ts) — so turning the digest on with nothing here yet would
    // silently configure something that can never actually send. Pre-filling with the account's own
    // email keeps "Turn on" a genuine one-step action; DigestEmailField reads the pre-filled value
    // straight off settings (see its own doc comment), so it renders already-collapsed rather than
    // replaying the "just saved" animation for a value the user didn't type. Removing it afterward
    // (via DigestEmailField's own Remove link) is what opts back out, same as before.
    if (!settings.digestEmailOverride && currentUser?.email) {
      updates.digestEmailOverride = currentUser.email;
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
          // Turning OFF never touches aiConfig, so it's never gated — only enabling is, and only
          // until the AI config fetch actually resolves. Without this, clicking "Turn on" before
          // that resolves reads aiConfig.provider as its still-loading default (null) even when the
          // real saved provider isn't, and silently overwrites it with Gemini (see enable()).
          disabled={!settings.digestEnabled && aiConfigLoading}
          onClick={() => (settings.digestEnabled ? update({ digestEnabled: false }) : enable())}
        >
          {settings.digestEnabled ? 'Turn off' : aiConfigLoading ? 'Loading…' : 'Turn on'}
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
                emptyLabel="Add a channel first. There's nothing to include yet."
              />
            </div>

            {/* Required now, not optional — the digest no longer falls back to the sign-in email
                (see server/cron/digest.ts), so no email here means the digest is configured but
                silently never sends. Pre-filled with the account email the first time the digest
                is turned on (see enable() above); the Remove link inside is the deliberate way to
                opt back out without turning the whole feature off. */}
            <DigestEmailField
              email={settings.digestEmailOverride}
              onSave={(value) => update({ digestEmailOverride: value })}
              onRemove={() => update({ digestEmailOverride: null })}
            />
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
