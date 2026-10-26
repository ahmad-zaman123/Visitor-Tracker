import { sql, ensureSchema, isAdmin, clip } from './_lib.js';

export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  await ensureSchema();

  const site = clip(req.query.site, 32);
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  if (!site) return res.status(400).json({ error: 'site required' });

  const since = new Date(Date.now() - days * 864e5).toISOString();
  const sincePrev = new Date(Date.now() - 2 * days * 864e5).toISOString();
  const unit = days <= 1 ? 'hour' : 'day';

  const [totals, prev, daily, paths, countries, referrers, devices, named, recent, custom, live] = await Promise.all([
    sql`select count(*)::int as views, count(distinct vid)::int as visitors,
        count(distinct vid) filter (where name is not null)::int as named
        from events where event = 'pageview' and site_id = ${site} and ts >= ${since}`,
    sql`select count(*)::int as views, count(distinct vid)::int as visitors,
        count(distinct vid) filter (where name is not null)::int as named
        from events where event = 'pageview' and site_id = ${site} and ts >= ${sincePrev} and ts < ${since}`,
    sql`select date_trunc(${unit}, ts) as bucket, count(*)::int as views,
        count(distinct vid)::int as visitors
        from events where event = 'pageview' and site_id = ${site} and ts >= ${since}
        group by 1 order by 1`,
    sql`select coalesce(path, '/') as label, count(*)::int as n from events
        where event = 'pageview' and site_id = ${site} and ts >= ${since} group by 1 order by n desc limit 10`,
    sql`select coalesce(country, '??') as label, count(distinct vid)::int as n from events
        where event = 'pageview' and site_id = ${site} and ts >= ${since} group by 1 order by n desc limit 10`,
    sql`select coalesce(nullif(referrer, ''), 'Direct') as label, count(distinct vid)::int as n from events
        where event = 'pageview' and site_id = ${site} and ts >= ${since} group by 1 order by n desc limit 10`,
    sql`select device || ' / ' || browser as label, count(distinct vid)::int as n from events
        where event = 'pageview' and site_id = ${site} and ts >= ${since} group by 1 order by n desc limit 8`,
    sql`select name, count(*) filter (where event = 'pageview')::int as visits, max(ts) as last_seen,
        (array_agg(city order by ts desc) filter (where city is not null))[1] as city,
        (array_agg(country order by ts desc) filter (where country is not null))[1] as country,
        (array_agg(device order by ts desc))[1] as device,
        count(*) filter (where event <> 'pageview')::int as actions
        from events where name is not null and site_id = ${site} and ts >= ${since}
        group by name order by last_seen desc limit 50`,
    sql`select ts, name, event, path, country, city, device, browser, referrer from events
        where site_id = ${site} order by ts desc limit 40`,
    sql`select event as label, count(*)::int as n from events
        where event <> 'pageview' and site_id = ${site} and ts >= ${since} group by 1 order by n desc limit 10`,
    sql`select count(distinct vid)::int as n from events
        where site_id = ${site} and ts >= now() - interval '5 minutes'`,
  ]);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    totals: totals[0], prev: prev[0], daily, paths, countries, referrers, devices, named, recent, custom,
    live: live[0].n, days,
  });
}
