import { sql, ensureSchema, hashIp, parseUA, clip } from './_lib.js';

// Generous enough for a shared office network, tight enough that a flood can't fill the free database.
const PER_IP_PER_MIN = 120;
const PER_VISITOR_PER_MIN = 30;

const sitesCache = new Map(); // id -> { domain, at }

async function getSite(id) {
  const hit = sitesCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.domain;
  const [row] = await sql`select domain from sites where id = ${id}`;
  sitesCache.set(id, { domain: row?.domain ?? null, at: Date.now() });
  return row?.domain ?? null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    await ensureSchema();
    // sendBeacon posts text/plain, so the body may arrive as a string.
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const site = clip(b.site, 32);
    const vid = clip(b.vid, 64);
    if (!site || !vid) return res.status(400).end();

    const domain = await getSite(site);
    if (!domain) return res.status(404).end();

    // Ignore traffic from other origins (a copied site id on someone else's page).
    // "null" (sandboxed frames, file pages) and anything unparseable can't be checked, so they are dropped quietly.
    const origin = req.headers.origin || '';
    if (origin) {
      let host = '';
      try { host = new URL(origin).hostname; } catch { /* dropped below */ }
      const ok = host === domain || host.endsWith(`.${domain}`) || host === 'localhost';
      if (!ok) return res.status(204).end();
    }

    const { device, browser, bot } = parseUA(req.headers['user-agent']);
    if (bot) return res.status(204).end();

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const city = req.headers['x-vercel-ip-city'];

    // The endpoint is public, so cap how fast one address or one visitor id can write. Counted from the table itself,
    // which stays correct across serverless instances.
    const ipKey = hashIp(ip);
    const [recent] = await sql`select count(*) filter (where ip_hash = ${ipKey})::int as by_ip, count(*) filter (where vid = ${vid})::int as by_vid
      from events where ts > now() - interval '1 minute' and (ip_hash = ${ipKey} or vid = ${vid})`;
    if (recent.by_ip >= PER_IP_PER_MIN || recent.by_vid >= PER_VISITOR_PER_MIN) {
      res.setHeader('Retry-After', '60');
      return res.status(429).end();
    }

    const utm = b.utm && typeof b.utm === 'object' ? b.utm : {};
    await sql`insert into events (site_id, vid, name, event, path, referrer, country, city, device, browser, ip_hash, utm_source, utm_medium, utm_campaign)
      values (${site}, ${vid}, ${clip(b.name, 80)}, ${clip(b.event, 60) || 'pageview'}, ${clip(b.path, 300)},
        ${clip(b.referrer, 300)}, ${clip(req.headers['x-vercel-ip-country'], 2)},
        ${city ? decodeURIComponent(city) : null}, ${device}, ${browser}, ${ipKey},
        ${clip(utm.source, 60)}, ${clip(utm.medium, 60)}, ${clip(utm.campaign, 60)})`;

    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
}
