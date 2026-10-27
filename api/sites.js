import { randomBytes } from 'node:crypto';
import { sql, ensureSchema, whoIs, denyWrite, clip, cleanDomain, validDomain } from './_lib.js';
import { demoSites } from './_demo.js';

export default async function handler(req, res) {
  const who = whoIs(req);
  if (!who) return res.status(401).json({ error: 'unauthorized' });
  if (who === 'demo') return req.method === 'GET' ? res.json(demoSites()) : denyWrite(req, res);
  await ensureSchema();

  if (req.method === 'GET') {
    const rows = await sql`
      select s.id, s.name, s.domain, s.created_at,
        count(e.id) filter (where e.ts > now() - interval '30 days' and e.event = 'pageview') as views_30d,
        count(distinct e.vid) filter (where e.ts > now() - interval '5 minutes')::int as live
      from sites s left join events e on e.site_id = s.id
      group by s.id order by s.created_at`;
    return res.json(rows);
  }

  if (req.method === 'POST') {
    const name = clip(req.body?.name, 80);
    const domain = cleanDomain(clip(req.body?.domain, 200));
    if (!name || !domain) return res.status(400).json({ error: 'name and domain required' });
    if (!validDomain(domain)) return res.status(400).json({ error: 'enter a domain like mysite.vercel.app' });
    const id = randomBytes(5).toString('hex');
    await sql`insert into sites (id, name, domain) values (${id}, ${name}, ${domain})`;
    return res.status(201).json({ id, name, domain });
  }

  if (req.method === 'PATCH') {
    const id = clip(req.query.id, 32);
    const name = clip(req.body?.name, 80);
    const domain = cleanDomain(clip(req.body?.domain, 200));
    if (!id || !name || !domain) return res.status(400).json({ error: 'id, name and domain required' });
    if (!validDomain(domain)) return res.status(400).json({ error: 'enter a domain like mysite.vercel.app' });
    const [row] = await sql`update sites set name = ${name}, domain = ${domain} where id = ${id} returning id, name, domain`;
    if (!row) return res.status(404).json({ error: 'not found' });
    return res.json(row);
  }

  if (req.method === 'DELETE') {
    const id = clip(req.query.id, 32);
    if (!id) return res.status(400).json({ error: 'id required' });
    // ?events=1 empties the site's visits but keeps the site itself.
    if (req.query.events === '1') await sql`delete from events where site_id = ${id}`;
    else await sql`delete from sites where id = ${id}`;
    return res.status(204).end();
  }

  res.status(405).end();
}
