/** Turns DigestContent (build.ts) into an actual email — subject + a self-contained HTML body.
 * Plain, table-free inline-styled HTML: no build step, no external stylesheet, and email clients
 * are hostile enough to CSS that keeping this simple is the reliable choice. */

import type { DigestContent } from './build';

const APP_URL = 'https://usecatchup.app';

// The same ketchup-bottle mark as src/components/Layout/Logo.tsx, inlined as literal SVG rather
// than an <img> — no external hosting to keep up, transparent by construction (no background
// rect), and inline SVG renders in every mainstream email client (Gmail, Apple Mail, the Outlook
// web/new-Outlook clients) except old desktop Outlook's Word rendering engine, which is an
// acceptable gap for this app's realistic audience. Fixed 28px size, matching Logo's own default.
const LOGO_SVG = `<svg width="12" height="28" viewBox="0 0 40 92" aria-hidden="true">
  <rect x="10.5" y="2" width="19" height="9" rx="2.2" fill="#cfd2d4" stroke="#1a1a1a" stroke-width="1.6" />
  <line x1="11.8" y1="7.7" x2="28.2" y2="7.7" stroke="#9aa0a3" stroke-width="1.4" />
  <path d="M13.5 11 L13.5 21 C13.5 28 5 31 5 41 L5 84 Q5 90.5 12 90.5 L28 90.5 Q35 90.5 35 84 L35 41 C35 31 26.5 28 26.5 21 L26.5 11 Z" fill="#c1272d" stroke="#1a1a1a" stroke-width="2.1" stroke-linejoin="round" />
  <path d="M9 51 Q20 46 31 51 L28.5 82 Q20 85.5 11.5 82 Z" fill="#f2f0ec" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round" />
</svg>`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function digestSubject(content: DigestContent): string {
  const totalStories = content.channels.reduce((n, c) => n + c.stories.length, 0);
  return `Your Catch Up digest — ${totalStories} ${totalStories === 1 ? 'story' : 'stories'}`;
}

export function renderDigestEmail(content: DigestContent): string {
  const summaryHtml = content.summary
    ? `<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 28px;">${escapeHtml(content.summary)}</p>`
    : '';

  const channelsHtml = content.channels
    .map((channel, i) => {
      const storiesHtml = channel.stories
        .map(
          (story) => `
        <li style="margin:0 0 10px;">
          <a href="${escapeHtml(story.url)}" style="color:#1a1a1a;font-weight:600;text-decoration:none;font-size:14px;">${escapeHtml(story.title)}</a>
          <div style="color:#888;font-size:12px;margin-top:2px;">${escapeHtml(story.source)}</div>
        </li>`
        )
        .join('');
      // A thin top border on every channel EXCEPT the first — a divider BETWEEN sections, not a
      // trailing line after the last one.
      const dividerStyle = i > 0 ? 'border-top:1px solid #e5e5e5;padding-top:24px;' : '';
      return `
      <div style="margin:0 0 24px;${dividerStyle}">
        <a href="${APP_URL}/channel/${encodeURIComponent(channel.channelSlug)}" style="font-size:13px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#c1440e;text-decoration:none;">${escapeHtml(channel.channelName)}</a>
        <ul style="list-style:none;padding:0;margin:10px 0 0;">${storiesHtml}</ul>
      </div>`;
    })
    .join('');

  return `
<div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="margin-bottom:24px;display:flex;align-items:center;gap:10px;">
    ${LOGO_SVG}
    <span style="font-size:18px;font-weight:700;color:#1a1a1a;">Catch Up</span>
  </div>
  ${summaryHtml}
  ${channelsHtml}
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#999;">
    <a href="${APP_URL}/#/settings" style="color:#999;">Open Catch Up settings</a> — change your digest settings or turn it off anytime.
  </p>
</div>`;
}
