import { ChannelManageList } from './ChannelManageList';
import { ProviderStatusPanel } from './ProviderStatusPanel';
import { RollTheDiceSettings } from './RollTheDiceSettings';
import { MaxStoriesSetting } from './MaxStoriesSetting';
import { AiFilteringSetting } from './AiFilteringSetting';
import { LocationSetting } from './LocationSetting';
import { CustomSourcesSetting } from './CustomSourcesSetting';
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
        <h2 className="settings-section__title">AI filtering</h2>
        <AiFilteringSetting />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">News providers</h2>
        <ProviderStatusPanel />
      </section>

      {isWeb && (
        <section className="settings-section">
          <h2 className="settings-section__title">Your own sources</h2>
          <CustomSourcesSetting />
        </section>
      )}

      {/* Renders its own section wrapper (or nothing at all, on desktop / before a user loads) —
          see AccountSection.tsx. */}
      <AccountSection />
    </div>
  );
}
