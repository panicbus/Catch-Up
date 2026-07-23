import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { ProviderStatus } from '../../../ipc-contract';
import { SourceStatusDot } from './SourceStatusDot';
import '../Settings/SettingsPage.css';
import './AboutPage.css';

export function AboutPage() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    void api.getProviderStatus().then(setProviders);
  }, []);

  return (
    <div className="settings-page about-page">
      <h1 className="settings-page__title">About Catch Up</h1>

      <section className="settings-section">
        <p className="about-page__intro">
          Catch Up is a personal news reader built to be read start to finish, not scrolled
          forever. Open it, catch up on your channels, and close it, no infinite feed and no
          algorithm quietly deciding what you see or how long you stay.
        </p>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Channels &amp; subchannels</h2>
        <p className="about-page__text">
          A channel is a topic you follow, like a team, a band, a subject, or anything else you
          want to keep up with. Subchannels narrow that further, say one player or one album, and
          their stories are added on top of the channel's own coverage rather than replacing it,
          so you still see the bigger picture too.
        </p>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Reading a story</h2>
        <p className="about-page__text">
          Cards with a snippet or image expand right in the app so you can preview a story before
          deciding to click through. Cards without either link straight to the source instead,
          since there's nothing extra here worth pausing on first.
        </p>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">The Pool, Bookmarks &amp; streak</h2>
        <p className="about-page__text">
          <strong>The Pool</strong> combines every channel into one feed. <strong>Bookmarks</strong>{' '}
          save a story for later. Your <strong>streak</strong> counts the days you've kept up with
          a channel. Read stories stay in an archive for two weeks.
        </p>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">News sources</h2>
        <p className="about-page__text">
          Every story comes from one of the sources below, pulled in parallel with no overlapping coverage.
        </p>
        <ul className="about-page__sources-list">
          {providers.map((p) => (
            <li key={p.id}>
              {p.label}
              <SourceStatusDot provider={p} />
            </li>
          ))}
        </ul>
      </section>

      <footer className="about-page__footer">
        <p className="about-page__footer-line">
          Report a bug, send feedback,{' '}
          <a href="mailto:nicocrisafulli@gmail.com" className="about-page__footer-link">
            email me
          </a>
          .
        </p>
        <a
          href="https://ko-fi.com/nicocrisafulli"
          target="_blank"
          rel="noopener noreferrer"
          className="about-page__footer-link"
        >
          Buy me a coffee!
        </a>
        <p className="about-page__footer-credit">
          Developed with ❤️ by Nico Crisafulli alongside Claude AI 🤖
        </p>
        <p className="about-page__footer-credit">Alameda, CA © 2026</p>
      </footer>
    </div>
  );
}
