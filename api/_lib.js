import { neon } from '@neondatabase/serverless';
import { createHash, timingSafeEqual } from 'node:crypto';

export const sql = neon(process.env.DATABASE_URL);

let ready;
// Creates the tables on first use so there is no separate migration step.
export function ensureSchema() {
  ready ??= (async () => {
    await sql`create table if not exists sites (
      id text primary key, name text not null, domain text not null,
      created_at timestamptz not null default now())`;
    await sql`create table if not exists events (
      id bigserial primary key,
      site_id text not null references sites(id) on delete cascade,
      ts timestamptz not null default now(),
      vid text not null, name text, event text not null default 'pageview',
      path text, referrer text, country text, city text, device text, browser text, ip_hash text)`;
    await sql`create index if not exists events_site_ts on events (site_id, ts desc)`;
    await sql`create index if not exists events_site_name on events (site_id, name) where name is not null`;
  })();
  return ready;
}

export function isAdmin(req) {
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const want = process.env.ADMIN_PASSWORD || '';
  if (!want || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export function hashIp(ip) {
  return createHash('sha256').update(`${process.env.HASH_SALT || ''}${ip}`).digest('hex').slice(0, 16);
}

export function parseUA(ua = '') {
  const device = /ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|android|iphone/i.test(ua) ? 'Mobile' : 'Desktop';
  const browser =
    /edg\//i.test(ua) ? 'Edge' :
    /opr\/|opera/i.test(ua) ? 'Opera' :
    /firefox/i.test(ua) ? 'Firefox' :
    /chrome|crios/i.test(ua) ? 'Chrome' :
    /safari/i.test(ua) ? 'Safari' : 'Other';
  const bot = /bot|crawl|spider|slurp|preview|headless|lighthouse/i.test(ua);
  return { device, browser, bot };
}

export function clip(v, n) {
  return typeof v === 'string' && v ? v.slice(0, n) : null;
}
