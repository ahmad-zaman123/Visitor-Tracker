import { randomBytes } from 'node:crypto';
import { sql, ensureSchema, isAdmin, clip } from './_lib.js';

export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  await ensureSchema();

  if (req.method === 'GET') {
    const rows = await sql`
      select s.id, s.name, s.domain, s.created_at,
        count(e.id) filter (where e.ts > now() - interval '30 days') as events_30d
      from sites s left join events e on e.site_id = s.id
      group by s.id order by s.created_at`;
    return res.json(rows);
  }

  if (req.method === 'POST') {
    const name = clip(req.body?.name, 80);
    const domain = clip(req.body?.domain, 200)?.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!name || !domain) return res.status(400).json({ error: 'name and domain required' });
    const id = randomBytes(5).toString('hex');
    await sql`insert into sites (id, name, domain) values (${id}, ${name}, ${domain})`;
    return res.status(201).json({ id, name, domain });
  }

  if (req.method === 'DELETE') {
    const id = clip(req.query.id, 32);
    if (!id) return res.status(400).json({ error: 'id required' });
    await sql`delete from sites where id = ${id}`;
    return res.status(204).end();
  }

  res.status(405).end();
}
