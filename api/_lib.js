import { neon } from '@neondatabase/serverless';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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
    await sql`create table if not exists login_attempts (ip_hash text not null, ts timestamptz not null default now())`;
    await sql`create index if not exists login_attempts_ts on login_attempts (ts)`;
    await sql`create index if not exists events_site_name on events (site_id, name) where name is not null`;
  })();
  return ready;
}

// Constant-time check of the request's bearer token against a secret. An unset secret never matches.
export function hasBearer(req, want) {
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!want || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

// Sessions are a signed expiry time, not the password. Changing ADMIN_PASSWORD signs everyone out.
export const SESSION_HOURS = 12;
const sessionKey = () => createHash('sha256').update(`${process.env.ADMIN_PASSWORD || ''}|${process.env.HASH_SALT || ''}|session`).digest();
const sign = exp => createHmac('sha256', sessionKey()).update(String(exp)).digest('base64url');

export function makeSession() {
  const exp = Date.now() + SESSION_HOURS * 36e5;
  return { token: `${exp}.${sign(exp)}`, expires: exp };
}

export function isAdmin(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = given.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

export function passwordOk(given) {
  const want = process.env.ADMIN_PASSWORD || '';
  const a = createHash('sha256').update(String(given ?? '')).digest();
  const b = createHash('sha256').update(want).digest();
  return Boolean(want) && timingSafeEqual(a, b);
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

// "https://www.My-Site.vercel.app/path" -> "my-site.vercel.app"
export function cleanDomain(v) {
  return String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '').replace(/^www\./, '');
}
export function validDomain(d) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$|^localhost$/.test(d);
}

// Days to keep events. Never below 30, so a mistyped value cannot wipe recent data.
export function retentionDays() {
  return Math.max(parseInt(process.env.RETENTION_DAYS, 10) || 180, 30);
}
