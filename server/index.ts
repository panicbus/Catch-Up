/** The hosted backend's entry point. Replaces main/ipcHandlers.ts's role for the website/mobile
 * apps — same operations as the desktop app's CatchUpApi contract (ipc-contract.ts), reached over
 * real HTTP instead of Electron's in-process bridge. Deployed on Render (see the approved
 * deployment plan); locally, run with `npm run dev:server`. */

import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { router } from './routes';

const PORT = Number(process.env.PORT) || 3001;

// Local dev origins, used ONLY as the fallback when ALLOWED_ORIGINS is unset. Deliberately NOT a
// wildcard, even though there's no auth in front of the API right now — an unset variable in a real
// deployment shouldn't additionally invite every origin in a browser.
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'];

// Comma-separated list of exact website origins allowed to call this API (e.g. the Vercel site's
// address). Note this is a browser-enforced control, not a real security boundary — a direct
// (non-browser) request ignores it entirely.
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : DEV_ORIGINS;

const app = express();

// Render terminates TLS at its proxy, so without this every request appears to come from the
// proxy's IP and the rate limits below would pool all callers into one bucket.
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: allowedOrigins }));

// Broad ceiling on total traffic. Sized well above real use (the web app polls every ~20s and
// fans out per channel) so it only catches genuine runaway/abusive volume. With the shared-password
// gate removed (2026-08-05), this is now the ONLY thing between the API and a runaway script — so
// it stays, and it deliberately isn't the per-IP brute-force limiter that used to sit beside it
// (that one locked the owner out of his own site during an unrelated outage).
app.use(
  '/api',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 2000, standardHeaders: 'draft-7', legacyHeaders: false })
);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// No authentication in front of the router. Deliberate and temporary: the shared password was
// removed because it was pure friction for a single-owner site while providing little real
// protection (the API address is discoverable in the public repo and in the site's own network
// traffic). Real Google sign-in is the planned replacement — until it ships, anyone who finds this
// address can read and modify this account's channels and stories. Provider API keys are still
// safe: they live in Settings and are never returned to any client.
app.use('/api', router);

// Last-resort handler so a throw anywhere in the stack becomes a clean 500 instead of a dangling
// request (or a leaked stack trace). Must keep all four parameters — that's how Express
// recognizes an error handler.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] unhandled error', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// Node terminates the process on an unhandled rejection by default, so a single stray promise
// could take the whole site down. Log and keep serving instead — the request that caused it has
// already failed, but every other user's requests are unaffected.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled promise rejection', reason);
});

// An uncaught exception genuinely can leave the process in an unreliable state, so this one does
// exit — deliberately different from the rejection handler above. Render restarts it immediately,
// which is safer than continuing on in an unknown state.
process.on('uncaughtException', (err) => {
  console.error('[server] uncaught exception — exiting for a clean restart', err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log(`[server] allowed origins: ${allowedOrigins.join(', ')}${configuredOrigins.length === 0 ? ' (dev fallback — ALLOWED_ORIGINS not set)' : ''}`);
});
