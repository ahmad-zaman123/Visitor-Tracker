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
    await sql`alter table events add column if not exists utm_source text, add column if not exists utm_medium text, add column if not exists utm_campaign text`;
    await sql`create table if not exists passkeys (
      id text primary key, public_key text not null, counter bigint not null default 0, transports text,
      label text, created_at timestamptz not null default now(), last_used timestamptz)`;
    await sql`create table if not exists passkey_challenges (
      challenge text primary key, purpose text not null, exp timestamptz not null)`;
    await sql`create index if not exists events_site_ts on events (site_id, ts desc)`;
    await sql`create table if not exists login_attempts (ip_hash text not null, ts timestamptz not null default now())`;
    await sql`create index if not exists login_attempts_ts on login_attempts (ts)`;
    await sql`create index if not exists events_ip_ts on events (ip_hash, ts desc)`;
    await sql`create index if not exists events_vid_ts on events (vid, ts desc)`;
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

// Sessions are a signed expiry time, not the password. They are signed with SESSION_SECRET, a random value
// that is used for nothing else. Admin sessions also mix in a hash of ADMIN_PASSWORD, so changing it signs
// everyone out. Demo sessions use their own key, which has nothing to do with the password, so a public
// demo token can't be used to test password guesses offline.
export const SESSION_HOURS = 12;
export const sessionReady = () => (process.env.SESSION_SECRET || '').length >= 32;
const keyFor = purpose => {
  if (!sessionReady()) throw new Error('SESSION_SECRET must be set to at least 32 random characters');
  return createHmac('sha256', process.env.SESSION_SECRET).update(purpose).digest();
};
const adminKey = () =>
  keyFor(`admin|${createHash('sha256').update(process.env.ADMIN_PASSWORD || '').digest('hex')}`);
const sign = (key, value) => createHmac('sha256', key).update(String(value)).digest('base64url');
const signedBy = (key, value, sig) => {
  const want = sign(key, value);
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
};

export function makeSession(hours = SESSION_HOURS) {
  const exp = Date.now() + hours * 36e5;
  return { token: `${exp}.${sign(adminKey(), exp)}`, expires: exp };
}

export function isAdmin(req) {
  if (!process.env.ADMIN_PASSWORD || !sessionReady()) return false;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = given.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return signedBy(adminKey(), exp, sig);
}

// Demo sessions are signed separately (`exp.d.sig`) and only count when DEMO_MODE=1. They never match isAdmin().
export const demoEnabled = () => process.env.DEMO_MODE === '1';
export const DEMO_HOURS = 2;

export function makeDemoSession() {
  const exp = Date.now() + DEMO_HOURS * 36e5;
  return { token: `${exp}.d.${sign(keyFor('demo'), exp)}`, expires: exp, demo: true };
}

export function isDemo(req) {
  if (!demoEnabled() || !sessionReady()) return false;
  const [exp, tag, sig] = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').split('.');
  if (!exp || tag !== 'd' || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return signedBy(keyFor('demo'), exp, sig);
}

// Who is asking: 'admin', 'demo' or null. Write endpoints answer a demo visitor with 403 so the dashboard keeps the session.
export const whoIs = req => (isAdmin(req) ? 'admin' : isDemo(req) ? 'demo' : null);
export const denyWrite = (req, res) =>
  isDemo(req) ? res.status(403).json({ error: 'Read-only demo' }) : res.status(401).json({ error: 'unauthorized' });

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


// Wrong-guess limiting shared by the password and fingerprint sign-ins.
const PER_IP = 5;      // failures per address per 15 minutes
const IN_TOTAL = 30;   // failures from anywhere per 15 minutes, so spreading guesses over many addresses doesn't help

export const clientKey = req => hashIp((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown');

// Returns null when sign-in may proceed, or the number of seconds to wait.
export async function signInBlocked(key) {
  const [c] = await sql`select
      count(*) filter (where ip_hash = ${key})::int as mine, count(*)::int as total,
      extract(epoch from (min(ts) filter (where ip_hash = ${key}) + interval '15 minutes' - now()))::int as wait
    from login_attempts where ts > now() - interval '15 minutes'`;
  if (c.mine >= PER_IP || c.total >= IN_TOTAL) return Math.max(c.wait || 900, 30);
  return null;
}

export async function recordSignInFailure(key) {
  await sql`insert into login_attempts (ip_hash) values (${key})`;
  const [c] = await sql`select count(*)::int as n from login_attempts where ip_hash = ${key} and ts > now() - interval '15 minutes'`;
  return Math.max(PER_IP - c.n, 0);
}
