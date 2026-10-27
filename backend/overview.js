import { sql, ensureSchema, whoIs } from './_lib.js';
import { demoOverview } from './_demo.js';

// One round trip for the whole "All sites" view: every query groups by site.
export default async function handler(req, res) {
  const who = whoIs(req);
  if (!who) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  if (who === 'demo') { res.setHeader('Cache-Control', 'no-store'); return res.json(demoOverview(days)); }
  await ensureSchema();
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const sincePrev = new Date(Date.now() - 2 * days * 864e5).toISOString();
  const unit = days <= 1 ? 'hour' : 'day';

  const [sites, cur, prev, daily, activity, recent, tops, srcs, acts, camp] = await Promise.all([
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
    sql`select distinct on (site_id) site_id, path, count(*)::int as n
        from events where event = 'pageview' and path is not null and ts >= ${since}
        group by site_id, path order by site_id, n desc`,
    sql`select distinct on (site_id) site_id, referrer, count(*)::int as n
        from events where event = 'pageview' and referrer is not null and referrer <> '' and ts >= ${since}
        group by site_id, referrer order by site_id, n desc`,
    sql`select site_id, count(*) filter (where event like 'downloaded-%')::int as downloads,
        count(*) filter (where event in ('clicked-email', 'clicked-phone'))::int as contacts
        from events where ts >= ${since} group by site_id`,
    sql`select concat_ws(' · ', utm_source, utm_medium, utm_campaign) as label, count(distinct vid)::int as n
        from events where event = 'pageview' and ts >= ${since}
          and (utm_source is not null or utm_medium is not null or utm_campaign is not null)
        group by utm_source, utm_medium, utm_campaign order by n desc limit 1`,
  ]);

  const by = rows => new Map(rows.map(r => [r.site_id, r]));
  const curBy = by(cur), prevBy = by(prev), actBy = by(activity), topBy = by(tops), srcBy = by(srcs), actsBy = by(acts);
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
      top_page: topBy.get(s.id)?.path ?? null,
      top_source: srcBy.get(s.id)?.referrer ?? null,
      downloads: actsBy.get(s.id)?.downloads ?? 0,
      contacts: actsBy.get(s.id)?.contacts ?? 0,
    })),
    top_campaign: camp[0] ?? null,
    recent,
  });
}
