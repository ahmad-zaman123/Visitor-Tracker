import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, auth } from './helpers.mjs';

const load = async n => (await import(`../backend/${n}.js`)).default;
const [login, sites, collect, stats, visitor, cleanup, overview] = await Promise.all(
  ['login', 'sites', 'collect', 'stats', 'visitor', 'cleanup', 'overview'].map(load));
const { sql } = await import('../backend/_lib.js');

const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';
let token, site;

const hit = (body, headers = {}) =>
  call(collect, { method: 'POST', body, headers: { 'user-agent': phone, 'x-forwarded-for': '198.51.100.7', ...headers } });

test('sign in: wrong password is refused, right password gives a session', async () => {
  const bad = await call(login, { method: 'POST', body: { password: 'nope' }, headers: { 'x-forwarded-for': '203.0.113.1' } });
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.body.left, 4);
  const ok = await call(login, { method: 'POST', body: { password: 'correct horse' }, headers: { 'x-forwarded-for': '203.0.113.2' } });
  assert.equal(ok.statusCode, 200);
  token = ok.body.token;
  assert.ok(ok.body.expires > Date.now());
});

test('sign in: five wrong guesses from one address pause further tries', async () => {
  const headers = { 'x-forwarded-for': '203.0.113.50' };
  for (let i = 0; i < 5; i++) await call(login, { method: 'POST', body: { password: 'x' }, headers });
  const blocked = await call(login, { method: 'POST', body: { password: 'correct horse' }, headers });
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers['retry-after']);
});

test('admin endpoints refuse requests without a session', async () => {
  for (const h of [sites, stats, overview, visitor, cleanup])
    assert.equal((await call(h, { query: { site: 'x', name: 'y' } })).statusCode, 401);
});

test('sites: add, validate, rename', async () => {
  const empty = await call(sites, { method: 'POST', headers: auth(token), body: { name: 'X', domain: 'not a domain' } });
  assert.equal(empty.statusCode, 400);
  const made = await call(sites, { method: 'POST', headers: auth(token), body: { name: 'Portfolio', domain: 'https://www.Example.com/about' } });
  assert.equal(made.statusCode, 201);
  assert.equal(made.body.domain, 'example.com');
  site = made.body.id;
  const renamed = await call(sites, { method: 'PATCH', headers: auth(token), query: { id: site }, body: { name: 'My portfolio', domain: 'example.com' } });
  assert.equal(renamed.body.name, 'My portfolio');
});

test('collect: records a pageview with a hashed IP and no raw address', async () => {
  const r = await hit({ site, vid: 'v1', name: 'Sara Acme', path: '/', referrer: 'linkedin.com', utm: { source: 'linkedin', campaign: 'job-oct' } }, { origin: 'https://example.com' });
  assert.equal(r.statusCode, 204);
  const [row] = await sql`select * from events where vid = 'v1'`;
  assert.equal(row.device, 'Mobile');
  assert.equal(row.browser, 'Safari');
  assert.equal(row.utm_campaign, 'job-oct');
  assert.match(row.ip_hash, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(row).includes('198.51.100.7'));
});

test('collect: drops bots, unknown sites and other origins', async () => {
  const before = (await sql`select count(*)::int as n from events`)[0].n;
  assert.equal((await hit({ site, vid: 'b1' }, { 'user-agent': 'Googlebot/2.1' })).statusCode, 204);
  assert.equal((await hit({ site: 'nope', vid: 'v9' })).statusCode, 404);
  assert.equal((await hit({ site, vid: 'v9' }, { origin: 'https://evil.example.org' })).statusCode, 204);
  assert.equal((await hit({ vid: 'v9' })).statusCode, 400);
  assert.equal((await sql`select count(*)::int as n from events`)[0].n, before);
});

test('collect: accepts sendBeacon text bodies and subdomains', async () => {
  const r = await hit(JSON.stringify({ site, vid: 'v2', event: 'downloaded-cv.pdf', path: '/' }), { origin: 'https://blog.example.com' });
  assert.equal(r.statusCode, 204);
  assert.equal((await sql`select count(*)::int as n from events where vid = 'v2'`)[0].n, 1);
});

test('collect: an Origin of "null" or garbage is ignored, not an error', async () => {
  const before = (await sql`select count(*)::int as n from events`)[0].n;
  for (const origin of ['null', 'not a url', 'ftp://']) assert.equal((await hit({ site, vid: 'o1' }, { origin })).statusCode, 204, origin);
  assert.equal((await sql`select count(*)::int as n from events`)[0].n, before);
});

// The rate-limit tests write to their own site, so they don't change the totals other tests check.
const scratchSite = async () => (await call(sites, { method: 'POST', headers: auth(token), body: { name: 'Scratch', domain: 'example.com' } })).body.id;

test('collect: one visitor id is capped per minute, and other visitors are unaffected', async () => {
  const site = await scratchSite();
  const ip = { 'x-forwarded-for': '192.0.2.200' };
  let codes = [];
  for (let i = 0; i < 32; i++) codes.push((await hit({ site, vid: 'flood' }, ip)).statusCode);
  assert.equal(codes.filter(c => c === 204).length, 30);
  assert.equal(codes.at(-1), 429);
  assert.equal((await hit({ site, vid: 'calm' }, { 'x-forwarded-for': '192.0.2.201' })).statusCode, 204);
});

test('collect: one address is capped per minute across many visitor ids', async () => {
  const site = await scratchSite();
  const ip = { 'x-forwarded-for': '192.0.2.250' };
  await sql`insert into events (site_id, vid, ip_hash) select ${site}, 'v' || g, ${(await import('../backend/_lib.js')).hashIp('192.0.2.250')} from generate_series(1, 120) g`;
  assert.equal((await hit({ site, vid: 'fresh-one' }, ip)).statusCode, 429);
  await sql`delete from sites where name = 'Scratch'`;
});

test('stats and visitor panel reflect what was collected', async () => {
  const s = await call(stats, { headers: auth(token), query: { site, days: '30' } });
  assert.equal(s.statusCode, 200);
  assert.equal(s.body.totals.views, 1);
  assert.equal(s.body.totals.named, 1);
  const v = await call(visitor, { headers: auth(token), query: { site, name: 'Sara Acme' } });
  assert.equal(v.body.visits, 1);
  assert.equal(v.body.campaign, 'linkedin · job-oct');
  assert.equal((await call(visitor, { headers: auth(token), query: { site, name: 'Nobody' } })).statusCode, 404);
});

test('overview groups every site in one response', async () => {
  const o = await call(overview, { headers: auth(token), query: { days: '30' } });
  const mine = o.body.sites.find(x => x.id === site);
  assert.equal(mine.totals.views, 1);
  assert.equal(mine.top_page, '/');
  assert.equal(mine.top_source, 'linkedin.com');
  assert.equal(o.body.top_campaign.label, 'linkedin · job-oct');
});

test('cleanup removes only events past the retention window', async () => {
  await sql`insert into events (site_id, vid, ts) values (${site}, 'old', now() - interval '400 days')`;
  const bad = await call(cleanup, { headers: { authorization: 'Bearer wrong' } });
  assert.equal(bad.statusCode, 401);
  const r = await call(cleanup, { headers: auth(token) });
  assert.equal(r.body.deleted, 1);
  assert.equal((await sql`select count(*)::int as n from events where vid = 'old'`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from events where vid = 'v1'`)[0].n, 1);
});

test('deleting a site removes its events too', async () => {
  const r = await call(sites, { method: 'DELETE', headers: auth(token), query: { id: site } });
  assert.equal(r.statusCode, 204);
  assert.equal((await sql`select count(*)::int as n from events where site_id = ${site}`)[0].n, 0);
});
