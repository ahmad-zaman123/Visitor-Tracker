import { sql, ensureSchema, isAdmin, clip } from './_lib.js';

export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  await ensureSchema();

  const site = clip(req.query.site, 32);
  const name = clip(req.query.name, 80);
  if (!site || !name) return res.status(400).json({ error: 'site and name required' });

  const [summary] = await sql`
    select count(*) filter (where event = 'pageview')::int as visits,
      count(*) filter (where event <> 'pageview')::int as actions,
      count(distinct vid)::int as devices,
      min(ts) as first_seen, max(ts) as last_seen
    from events where site_id = ${site} and name = ${name}`;
  if (!summary.first_seen) return res.status(404).json({ error: 'not found' });

  const events = await sql`
    select ts, event, path, referrer, country, city, device, browser
    from events where site_id = ${site} and name = ${name}
    order by ts desc limit 300`;

  res.setHeader('Cache-Control', 'no-store');
  res.json({ name, ...summary, events });
}
