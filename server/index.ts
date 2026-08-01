/** The hosted backend's entry point. Replaces main/ipcHandlers.ts's role for the website/mobile
 * apps — same operations as the desktop app's CatchUpApi contract (ipc-contract.ts), reached over
 * real HTTP instead of Electron's in-process bridge. Deployed on Render (see the approved
 * deployment plan); locally, run with `npm run server:dev`. */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const PORT = Number(process.env.PORT) || 3001;

// Comma-separated list of exact website origins allowed to call this API (e.g. the Vercel site's
// address) — a request from anywhere else is blocked by the browser itself, not by this code; this
// list just tells the browser who's allowed. See the deployment plan's explanation of CORS.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true, // dev fallback: allow any origin
  })
);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
