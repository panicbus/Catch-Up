import { ChannelManageList } from './ChannelManageList';
import { ProviderStatusPanel } from './ProviderStatusPanel';
import { RollTheDiceSettings } from './RollTheDiceSettings';
import './SettingsPage.css';

export function SettingsPage() {
  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>

      <section className="settings-section">
        <h2 className="settings-section__title">Channels &amp; subchannels</h2>
        <ChannelManageList />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Roll the dice</h2>
        <RollTheDiceSettings />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">News providers</h2>
        <ProviderStatusPanel />
      </section>
    </div>
  );
}
