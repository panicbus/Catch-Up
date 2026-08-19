import { ChannelManageList } from './ChannelManageList';
import { ProviderStatusPanel } from './ProviderStatusPanel';
import { RollTheDiceSettings } from './RollTheDiceSettings';
import { MaxStoriesSetting } from './MaxStoriesSetting';
import { AiFilteringSetting } from './AiFilteringSetting';
import { LocationSetting } from './LocationSetting';
import { CustomSourcesSetting } from './CustomSourcesSetting';
import { TrustedSourcesSetting } from './TrustedSourcesSetting';
import { DigestSetting } from './DigestSetting';
import { AccountSection } from '../Auth/AccountSection';
import './SettingsPage.css';

// Same guard CustomSourcesSetting itself uses — checked here too so its section wrapper (heading
// included) doesn't render on desktop, matching how AccountSection hides its own heading rather
// than leaving an orphan title over an empty section.
const isWeb = typeof window !== 'undefined' && !window.api;

export function SettingsPage() {
  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>

      <section className="settings-section">
        <h2 className="settings-section__title">Channels &amp; subchannels</h2>
        <ChannelManageList />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Your location</h2>
        <LocationSetting />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Stories shown</h2>
        <MaxStoriesSetting />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Roll the dice</h2>
        <RollTheDiceSettings />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Default news providers</h2>
        <ProviderStatusPanel />
      </section>

      {isWeb && (
        <section className="settings-section">
          <h2 className="settings-section__title">Your own sources</h2>
          <CustomSourcesSetting />
        </section>
      )}

      <section className="settings-section">
        <h2 className="settings-section__title">Trusted sources</h2>
        <TrustedSourcesSetting />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">AI filtering</h2>
        <AiFilteringSetting />
      </section>

      {isWeb && (
        <section className="settings-section">
          <h2 className="settings-section__title">Daily digest email</h2>
          <DigestSetting />
        </section>
      )}

      {/* Renders its own section wrapper (or nothing at all, on desktop / before a user loads) —
          see AccountSection.tsx. */}
      <AccountSection />

      {/* Sidebar.tsx already shows this, but the sidebar is hidden on mobile (see AppShell.css's
          767px breakpoint) — this is the only place a phone can ever see which build it's actually
          running. That matters concretely: this app has a documented history of a home-screen PWA
          sitting on a stale cached bundle for days after a deploy (see main.tsx's own comment on
          registerSW), so "did my fix actually reach this phone" was previously unanswerable here
          without plugging it into a computer. */}
      <p className="settings-page__version">App version {__APP_VERSION__}</p>
    </div>
  );
}
