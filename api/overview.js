import { sql, ensureSchema, isAdmin } from './_lib.js';

// One round trip for the whole "All sites" view: every query groups by site.
export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  await ensureSchema();

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const sincePrev = new Date(Date.now() - 2 * days * 864e5).toISOString();
  const unit = days <= 1 ? 'hour' : 'day';

  const [sites, cur, prev, daily, activity, recent] = await Promise.all([
    sql`select id, name, domain from sites order by created_at`,
    sql`select site_id, count(*)::int as views, count(distinct vid)::int as visitors,
        count(distinct vid) filter (where name is not null)::int as named
        from events where event = 'pageview' and ts >= ${since} group by site_id`,
    sql`select site_id, count(*)::int as views, count(distinct vid)::int as visitors,
        count(distinct vid) filter (where name is not null)::int as named
        from events where event = 'pageview' and ts >= ${sincePrev} and ts < ${since} group by site_id`,
    sql`select site_id, date_trunc(${unit}, ts) as bucket, count(*)::int as views
        from events where event = 'pageview' and ts >= ${since} group by 1, 2 order by 2`,
    sql`select site_id, max(ts) as last_seen,
        count(distinct vid) filter (where ts >= now() - interval '5 minutes')::int as live
        from events group by site_id`,
    sql`select site_id, name, max(ts) as last_seen, count(*) filter (where event = 'pageview')::int as visits,
        (array_agg(city order by ts desc) filter (where city is not null))[1] as city,
        (array_agg(country order by ts desc) filter (where country is not null))[1] as country
        from events where name is not null and ts >= ${since}
        group by site_id, name order by last_seen desc limit 12`,
  ]);

  const by = rows => new Map(rows.map(r => [r.site_id, r]));
  const curBy = by(cur), prevBy = by(prev), actBy = by(activity);
  const zero = { views: 0, visitors: 0, named: 0 };
  const series = new Map();
  for (const r of daily) {
    if (!series.has(r.site_id)) series.set(r.site_id, []);
    series.get(r.site_id).push({ bucket: r.bucket, views: r.views });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    days,
    sites: sites.map(s => ({
      ...s,
      totals: curBy.get(s.id) ?? zero,
      prev: prevBy.get(s.id) ?? zero,
      daily: series.get(s.id) ?? [],
      last_seen: actBy.get(s.id)?.last_seen ?? null,
      live: actBy.get(s.id)?.live ?? 0,
    })),
    recent,
  });
}
