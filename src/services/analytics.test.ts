import { afterEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import { scrubEvent, startAnalytics } from './analytics';

vi.mock('posthog-js', () => ({ default: { init: vi.fn(), capture: vi.fn() } }));

const at = (href: string) => new URL(href) as unknown as Location;

describe('scrubEvent', () => {
  it('keeps only the bare address, so sign-in codes and queries never leave the device', () => {
    const event = {
      event: '$pageview',
      properties: {
        $current_url: 'https://usecatchup.app/?code=secret-oauth-code#top',
        $pathname: '/',
        $host: 'usecatchup.app',
      },
      $set_once: { $initial_current_url: 'https://usecatchup.app/?code=secret-oauth-code' },
    };

    const out = scrubEvent(event as never, at('https://usecatchup.app/?code=secret-oauth-code#top'));

    expect(out?.properties.$current_url).toBe('https://usecatchup.app/');
    expect(out?.properties.$host).toBe('usecatchup.app');
    expect(JSON.stringify(out)).not.toContain('secret-oauth-code');
  });
});

describe('startAnalytics', () => {
  afterEach(() => vi.clearAllMocks());

  it('does nothing in the desktop app, local dev or previews', async () => {
    await startAnalytics(at('file:///Applications/Catch%20Up.app/index.html'));
    await startAnalytics(at('http://localhost:5173/'));
    await startAnalytics(at('https://catch-up-git-main-panic-bus.vercel.app/'));
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('counts the visit cookieless on usecatchup.app, with nothing automatic', async () => {
    await startAnalytics(at('https://usecatchup.app/'));

    expect(posthog.init).toHaveBeenCalledWith(
      expect.stringMatching(/^phc_/),
      expect.objectContaining({
        api_host: '/pbr',
        cookieless_mode: 'always',
        person_profiles: 'never',
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
      }),
    );
    expect(posthog.capture).toHaveBeenCalledWith('$pageview');
  });
});
