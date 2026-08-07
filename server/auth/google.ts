/** Verifies the Google ID token the browser gets from Google Identity Services.
 *
 * The flow is deliberately the client-side one: Google's own script renders the sign-in button and
 * hands the browser a signed ID token, which is POSTed here and verified server-side. That avoids
 * implementing an authorization-code redirect (callback route, state parameter, PKCE, a client
 * secret) for a single-page app that doesn't need any of it. The client id is not a secret — the
 * security comes from Google's signature over the token, which is what verifyIdToken checks, along
 * with the `audience` binding that stops a token minted for some OTHER app being replayed here. */

import { OAuth2Client } from 'google-auth-library';

const clientId = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(clientId);

export interface GoogleIdentity {
  /** Google's stable, never-reused account identifier. */
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export async function verifyGoogleCredential(credential: unknown): Promise<GoogleIdentity> {
  if (typeof credential !== 'string' || credential.length === 0) {
    throw new Error('Missing Google credential.');
  }
  if (!clientId) {
    // Should be unreachable — server/index.ts refuses to boot without it — but a sign-in route that
    // silently accepted unverifiable tokens would be far worse than a clear failure.
    throw new Error('Sign-in is not configured on this server.');
  }

  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw new Error('That Google account could not be verified.');
  // Google sets this false for unverified addresses; accepting one would let someone claim an email
  // they don't control, and since accounts are matched BY email that would hand them the matching
  // account's data.
  if (payload.email_verified === false) {
    throw new Error('That Google account’s email address is not verified.');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
  };
}
