import type { CaptureResult } from 'posthog-js';

// Anonymous visit counts for the web build at usecatchup.app, in the shared Panicbus Studios
// PostHog project (Nico, 2026-11-06). The desktop app never runs this: it only starts on the
// live host.
//
// Cookieless: nothing is stored on the device, and PostHog tells repeat visitors apart for one
// day from a server-side hash it never keeps. One $pageview per page load, sent with the bare
// address (no query or hash, so a Google sign-in code can't leak). Nothing automatic: no
// clicks, no replays, no profiles, never anything you read or follow. The privacy policy
// (panicbusapps.com/catchup/privacy.html) describes exactly this.

/** The project's public, write-only token. Safe in the bundle. */
const TOKEN = 'phc_ozvHgUZeNDiUSAYRE6GpxTtyyimqCkT9qr7jV2Uu6KZ3';
const LIVE_HOST = 'usecatchup.app';

/** Every event leaves with the bare page address: no query string, no hash. */
export function scrubEvent(event: CaptureResult | null, location: Location): CaptureResult | null {
  if (!event) return event;
  const bare = location.origin + location.pathname;
  const props: Record<string, unknown> = { ...event.properties };
  for (const [key, value] of Object.entries(props))
    if (typeof value === 'string' && value.startsWith(location.origin) && value !== bare) props[key] = bare;
  const { $set: _set, $set_once: _setOnce, ...rest } = event;
  return { ...rest, properties: props };
}

let started = false;

/**
 * Count this visit. Does nothing off the live site (desktop app, dev, previews), and only there
 * is PostHog's code even downloaded (a separate chunk), so the desktop app never loads it.
 */
export async function startAnalytics(location: Location = window.location) {
  if (started || location.hostname !== LIVE_HOST) return;
  started = true;
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(TOKEN, {
      // Our own path, proxied to PostHog by vercel.json, so blockers don't drop it.
      api_host: '/pbr',
      ui_host: 'https://us.posthog.com',
      cookieless_mode: 'always',
      person_profiles: 'never',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      before_send: (event) => scrubEvent(event, location),
    });
    posthog.capture('$pageview');
  } catch {
    // Counting visits must never break the app.
  }
}
