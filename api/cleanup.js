import { sql, ensureSchema, hasBearer, isAdmin } from './_lib.js';

// Deletes events older than RETENTION_DAYS (default 180). Vercel Cron calls this daily and sends
// "Authorization: Bearer $CRON_SECRET"; the admin password also works for a manual run.
export default async function handler(req, res) {
  const cronOk = hasBearer(req, process.env.CRON_SECRET || '');
  if (!cronOk && !isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  await ensureSchema();

  const days = Math.max(parseInt(process.env.RETENTION_DAYS, 10) || 180, 30);
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const [row] = await sql`with gone as (delete from events where ts < ${cutoff} returning 1)
    select count(*)::int as deleted from gone`;

  res.setHeader('Cache-Control', 'no-store');
  res.json({ retentionDays: days, cutoff, deleted: row.deleted });
}
