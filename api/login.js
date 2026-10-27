import { sql, ensureSchema, hashIp, passwordOk, makeSession } from './_lib.js';

const WINDOW_MIN = 15;
const PER_IP = 5;      // wrong guesses per address per window
const IN_TOTAL = 30;   // wrong guesses from anywhere per window, so spreading over many addresses doesn't help

// POST { password } -> { token, expires }. The token is a 12-hour signed session; the password itself is never kept.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  await ensureSchema();

  const ip = hashIp((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown');
  const [c] = await sql`select
      count(*) filter (where ip_hash = ${ip})::int as mine, count(*)::int as total,
      extract(epoch from (min(ts) filter (where ip_hash = ${ip}) + interval '15 minutes' - now()))::int as wait
    from login_attempts where ts > now() - interval '15 minutes'`;
  if (c.mine >= PER_IP || c.total >= IN_TOTAL) {
    const wait = Math.max(c.wait || WINDOW_MIN * 60, 30);
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ error: 'too many attempts', retryAfter: wait });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!passwordOk(body?.password)) {
    await sql`insert into login_attempts (ip_hash) values (${ip})`;
    return res.status(401).json({ error: 'unauthorized', left: Math.max(PER_IP - c.mine - 1, 0) });
  }
  res.json(makeSession());
}
