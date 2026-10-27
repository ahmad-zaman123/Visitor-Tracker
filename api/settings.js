import { sql, ensureSchema, whoIs, retentionDays } from './_lib.js';
import { demoSettings } from './_demo.js';

// Read-only facts for the settings page: how long events are kept, whether the daily cleanup is armed,
// and how much each site has stored.
export default async function handler(req, res) {
  const who = whoIs(req);
  if (!who) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  if (who === 'demo') return res.json(demoSettings());
  await ensureSchema();

  const sites = await sql`select site_id, count(*)::int as total, min(ts) as oldest from events group by site_id`;

  res.setHeader('Cache-Control', 'no-store');
  res.json({ retentionDays: retentionDays(), cronConfigured: Boolean(process.env.CRON_SECRET), sites });
}
