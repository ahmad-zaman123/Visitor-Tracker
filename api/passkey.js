import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { sql, ensureSchema, isAdmin, makeSession, clientKey, signInBlocked, recordSignInFailure, clip } from './_lib.js';

const b64 = u8 => Buffer.from(u8).toString('base64url');
const unb64 = s => new Uint8Array(Buffer.from(s, 'base64url'));
const USER_ID = new TextEncoder().encode('visitor-tracker-admin');

// The browser only signs for the site it registered on, so these come from the address the request arrived at.
function where(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const local = /^localhost(:\d+)?$/.test(host);
  return { rpID: host.replace(/:\d+$/, ''), origin: `${local ? 'http' : 'https'}://${host}` };
}

// Each challenge is issued once and burned on first use, so a captured response can't be replayed.
async function issue(purpose, challenge) {
  await sql`delete from passkey_challenges where exp < now()`;
  await sql`insert into passkey_challenges (challenge, purpose, exp) values (${challenge}, ${purpose}, now() + interval '5 minutes')`;
}
const burn = purpose => async challenge => {
  const rows = await sql`delete from passkey_challenges where challenge = ${challenge} and purpose = ${purpose} and exp > now() returning 1`;
  return rows.length === 1;
};

const readBody = req => {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === 'object' ? b : {};
};

// GET                       -> this account's fingerprint / Face ID devices (signed in)
// POST ?action=reg-options  -> start adding this device (signed in)
// POST ?action=reg-verify   -> finish adding it (signed in)
// POST ?action=auth-options -> start a fingerprint sign-in
// POST ?action=auth-verify  -> finish it and return a session, like /api/login
// DELETE ?id=               -> forget a device (signed in)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  await ensureSchema();
  const { rpID, origin } = where(req);
  const action = String(req.query.action || '');

  try {
    if (req.method === 'GET' || req.method === 'DELETE' || action === 'reg-options' || action === 'reg-verify') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
    }

    if (req.method === 'GET') {
      const rows = await sql`select id, label, created_at, last_used from passkeys order by created_at`;
      return res.json(rows);
    }

    if (req.method === 'DELETE') {
      const id = clip(req.query.id, 512);
      if (!id) return res.status(400).json({ error: 'id required' });
      const gone = await sql`delete from passkeys where id = ${id} returning 1`;
      return gone.length ? res.status(204).end() : res.status(404).json({ error: 'not found' });
    }

    if (req.method !== 'POST') return res.status(405).end();

    if (action === 'reg-options') {
      const have = await sql`select id, transports from passkeys`;
      const opts = await generateRegistrationOptions({
        rpName: 'Visitor Tracker', rpID, userName: 'admin', userDisplayName: 'Visitor Tracker', userID: USER_ID,
        attestationType: 'none',
        excludeCredentials: have.map(r => ({ id: r.id, transports: r.transports ? r.transports.split(',') : undefined })),
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      });
      await issue('reg', opts.challenge);
      return res.json(opts);
    }

    if (action === 'reg-verify') {
      const body = readBody(req);
      let v;
      try {
        v = await verifyRegistrationResponse({
          response: body.response, expectedChallenge: burn('reg'), expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        });
      } catch { v = { verified: false }; }
      if (!v.verified) return res.status(400).json({ error: 'could not verify this device' });
      const c = v.registrationInfo.credential;
      await sql`insert into passkeys (id, public_key, counter, transports, label)
        values (${c.id}, ${b64(c.publicKey)}, ${c.counter}, ${(c.transports || []).join(',') || null}, ${clip(body.label, 60) || 'This device'})
        on conflict (id) do nothing`;
      return res.json({ id: c.id });
    }

    if (action === 'auth-options') {
      const wait = await signInBlocked(clientKey(req));
      if (wait) { res.setHeader('Retry-After', String(wait)); return res.status(429).json({ error: 'too many attempts', retryAfter: wait }); }
      const [n] = await sql`select count(*)::int as n from passkey_challenges where exp > now()`;
      if (n.n > 100) return res.status(429).json({ error: 'busy, try again shortly' });
      const opts = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
      await issue('auth', opts.challenge);
      return res.json(opts);
    }

    if (action === 'auth-verify') {
      const key = clientKey(req);
      const wait = await signInBlocked(key);
      if (wait) { res.setHeader('Retry-After', String(wait)); return res.status(429).json({ error: 'too many attempts', retryAfter: wait }); }
      const body = readBody(req);
      const id = clip(body.response?.id, 512);
      const [row] = id ? await sql`select id, public_key, counter, transports from passkeys where id = ${id}` : [];
      if (!row) { await recordSignInFailure(key); return res.status(404).json({ error: 'unknown device' }); }
      let v;
      try {
        v = await verifyAuthenticationResponse({
          response: body.response, expectedChallenge: burn('auth'), expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
          credential: { id: row.id, publicKey: unb64(row.public_key), counter: Number(row.counter), transports: row.transports ? row.transports.split(',') : undefined },
        });
      } catch { v = { verified: false }; }
      if (!v.verified) return res.status(401).json({ error: 'unauthorized', left: await recordSignInFailure(key) });
      await sql`update passkeys set counter = ${v.authenticationInfo.newCounter}, last_used = now() where id = ${row.id}`;
      return res.json(makeSession());
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'something went wrong' });
  }
}
