import { ensureSchema, sessionReady, passwordOk, makeSession, makeDemoSession, demoEnabled, whoIs, setSessionCookie, clearSessionCookie, clientKey, signInBlocked, recordSignInFailure } from './_lib.js';

// POST { password, remember? } -> { expires }, with the session (12 hours, or 30 days with remember) in an httpOnly
// cookie. GET says who is signed in and whether the demo is on. DELETE signs out. The password itself is never kept.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ demo: demoEnabled(), who: whoIs(req) });
  if (req.method === 'DELETE') { clearSessionCookie(res); return res.status(204).end(); }
  if (req.method !== 'POST') return res.status(405).end();

  if (!sessionReady()) return res.status(503).json({ error: 'SESSION_SECRET is not set on the server' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body?.demo === true) {
    if (!demoEnabled()) return res.status(404).json({ error: 'demo is off' });
    const session = makeDemoSession();
    setSessionCookie(res, session, false);
    return res.json({ expires: session.expires, demo: true });
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
  const remember = body?.remember === true;
  const session = makeSession(remember ? 24 * 30 : undefined);
  setSessionCookie(res, session, remember);
  res.json({ expires: session.expires });
}
