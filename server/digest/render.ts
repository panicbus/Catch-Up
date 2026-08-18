/** Turns DigestContent (build.ts) into an actual email — subject + a self-contained HTML body.
 * Plain, table-free inline-styled HTML: no build step, no external stylesheet, and email clients
 * are hostile enough to CSS that keeping this simple is the reliable choice. */

import type { DigestContent } from './build';

const APP_URL = 'https://usecatchup.app';

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
    .map((channel) => {
      const storiesHtml = channel.stories
        .map(
          (story) => `
        <li style="margin:0 0 10px;">
          <a href="${escapeHtml(story.url)}" style="color:#1a1a1a;font-weight:600;text-decoration:none;font-size:14px;">${escapeHtml(story.title)}</a>
          <div style="color:#888;font-size:12px;margin-top:2px;">${escapeHtml(story.source)}</div>
        </li>`
        )
        .join('');
      return `
      <div style="margin:0 0 24px;">
        <a href="${APP_URL}/channel/${encodeURIComponent(channel.channelSlug)}" style="font-size:13px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#c1440e;text-decoration:none;">${escapeHtml(channel.channelName)}</a>
        <ul style="list-style:none;padding:0;margin:10px 0 0;">${storiesHtml}</ul>
      </div>`;
    })
    .join('');

  return `
<div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="margin-bottom:24px;">
    <span style="font-size:18px;font-weight:700;color:#1a1a1a;">Catch Up</span>
  </div>
  ${summaryHtml}
  ${channelsHtml}
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#999;">
    <a href="${APP_URL}" style="color:#999;">Open Catch Up</a> — change your digest settings or turn it off anytime.
  </p>
</div>`;
}
