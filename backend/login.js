import { ensureSchema, passwordOk, makeSession, makeDemoSession, demoEnabled, clientKey, signInBlocked, recordSignInFailure } from './_lib.js';

// POST { password, remember? } -> { token, expires }. The token is a signed session (12 hours, or 30 days with remember);
// the password itself is never kept.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // The sign-in page asks this to know whether to offer "Try the demo".
  if (req.method === 'GET') return res.json({ demo: demoEnabled() });
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body?.demo === true) {
    return demoEnabled() ? res.json(makeDemoSession()) : res.status(404).json({ error: 'demo is off' });
  }
  await ensureSchema();

  const key = clientKey(req);
  const wait = await signInBlocked(key);
  if (wait) {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ error: 'too many attempts', retryAfter: wait });
  }

  if (!passwordOk(body?.password)) {
    return res.status(401).json({ error: 'unauthorized', left: await recordSignInFailure(key) });
  }
  res.json(makeSession(body?.remember === true ? 24 * 30 : undefined));
}
