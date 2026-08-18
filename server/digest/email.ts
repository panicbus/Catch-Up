/** Resend wrapper — the one place that actually sends a digest email. Kept deliberately thin: no
 * retry/queue logic, since server/cron/digest.ts's hourly + dedupe-by-date design already means a
 * failed send just gets picked up again next cycle (before lastDigestSentDate is written) rather
 * than needing its own retry. */

import { Resend } from 'resend';

// The verified sending domain — see RESEND.md (or whatever setup doc) for the DNS records this
// depends on. Not configurable via env: this is the one address Catch Up ever sends digests from.
const FROM = 'Catch Up <digest@usecatchup.app>';

let client: Resend | null = null;
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

/** Returns true on success. False (never throws) on any failure — no key configured, the API
 * rejects the request, or a network error — so a single bad send can't take down the whole cron
 * run for every other user. */
export async function sendDigestEmail(to: string, subject: string, html: string): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    console.warn('[digest] RESEND_API_KEY not set — skipping send');
    return false;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error('[digest] Resend rejected the send:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[digest] send failed:', err);
    return false;
  }
}
