import { sql, ensureSchema, isAdmin } from './_lib.js';

const BATCH = 5000;
const COLS = ['ts', 'site', 'name', 'event', 'path', 'referrer', 'country', 'city', 'device', 'browser', 'visitor_id', 'utm_source', 'utm_medium', 'utm_campaign'];

// A leading = + - @ makes spreadsheets run the cell as a formula, so those get a quote in front.
const cell = v => {
  if (v === null || v === undefined) return '';
  let t = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};

// GET ?kind=csv&site=<id>  -> that site's events as a spreadsheet
// GET ?kind=backup         -> every site and every event as JSON
// Rows are read in batches by id and written as they come, so big exports never sit in memory.
export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  await ensureSchema();

  const kind = req.query.kind === 'backup' ? 'backup' : 'csv';
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Cache-Control', 'no-store');

  if (kind === 'csv') {
    const site = String(req.query.site || '');
    const [s] = await sql`select id, name from sites where id = ${site}`;
    if (!s) return res.status(404).json({ error: 'site not found' });
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || s.id;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-events-${stamp}.csv"`);
    res.write('\ufeff' + COLS.join(',') + '\n');
    let after = 0;
    for (;;) {
      const rows = await sql`select id, ts, name, event, path, referrer, country, city, device, browser, vid, utm_source, utm_medium, utm_campaign
        from events where site_id = ${site} and id > ${after} order by id limit ${BATCH}`;
      if (!rows.length) break;
      res.write(rows.map(r => [r.ts, s.name, r.name, r.event, r.path, r.referrer, r.country, r.city, r.device, r.browser, r.vid, r.utm_source, r.utm_medium, r.utm_campaign].map(cell).join(',')).join('\n') + '\n');
      after = Number(rows[rows.length - 1].id);
      if (rows.length < BATCH) break;
    }
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="visitor-tracker-backup-${stamp}.json"`);
  const sites = await sql`select id, name, domain, created_at from sites order by created_at`;
  res.write(`{"exported_at":${JSON.stringify(new Date().toISOString())},"sites":${JSON.stringify(sites)},"events":[`);
  let after = 0, first = true;
  for (;;) {
    const rows = await sql`select id, site_id, ts, vid, name, event, path, referrer, country, city, device, browser, ip_hash, utm_source, utm_medium, utm_campaign
      from events where id > ${after} order by id limit ${BATCH}`;
    if (!rows.length) break;
    res.write((first ? '' : ',') + rows.map(r => JSON.stringify(r)).join(','));
    first = false;
    after = Number(rows[rows.length - 1].id);
    if (rows.length < BATCH) break;
  }
  res.write(']}');
  res.end();
}
