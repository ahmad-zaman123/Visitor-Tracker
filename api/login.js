import { ensureSchema, passwordOk, makeSession, clientKey, signInBlocked, recordSignInFailure } from './_lib.js';

// POST { password } -> { token, expires }. The token is a 12-hour signed session; the password itself is never kept.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  await ensureSchema();

  const key = clientKey(req);
  const wait = await signInBlocked(key);
  if (wait) {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ error: 'too many attempts', retryAfter: wait });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!passwordOk(body?.password)) {
    return res.status(401).json({ error: 'unauthorized', left: await recordSignInFailure(key) });
  }
  res.json(makeSession());
}
