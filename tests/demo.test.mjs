import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, auth } from './helpers.mjs';

const load = async n => (await import(`../api/${n}.js`)).default;
const [login, sites, stats, overview, visitor, settings, exportH, passkey, cleanup] = await Promise.all(
  ['login', 'sites', 'stats', 'overview', 'visitor', 'settings', 'export', 'passkey', 'cleanup'].map(load));
const { sql } = await import('../api/_lib.js');

test('the demo is off unless DEMO_MODE=1', async () => {
  delete process.env.DEMO_MODE;
  assert.deepEqual((await call(login)).body, { demo: false });
  assert.equal((await call(login, { method: 'POST', body: { demo: true } })).statusCode, 404);
});

test('demo session works, shows sample data and never reads the database', async () => {
  process.env.DEMO_MODE = '1';
  assert.deepEqual((await call(login)).body, { demo: true });
  const s = await call(login, { method: 'POST', body: { demo: true } });
  assert.equal(s.statusCode, 200);
  assert.equal(s.body.demo, true);
  const h = auth(s.body.token);

  const ov = await call(overview, { headers: h, query: { days: '30' } });
  assert.equal(ov.body.sites.length, 3);
  assert.ok(ov.body.sites[0].totals.views > 0);
  assert.ok(ov.body.recent.length > 0);

  const st = await call(stats, { headers: h, query: { site: 'demo-portfolio', days: '30' } });
  assert.equal(st.body.daily.length, 31);
  assert.ok(st.body.named.length > 0 && st.body.paths.length > 0 && st.body.campaigns.length > 0);
  assert.equal((await call(stats, { headers: h, query: { site: 'demo-portfolio', days: '1' } })).body.daily.length, 25);

  const v = await call(visitor, { headers: h, query: { site: 'demo-portfolio', name: 'Sara Acme' } });
  assert.equal(v.body.name, 'Sara Acme');
  assert.ok(v.body.events.length > 0);
  assert.equal((await call(visitor, { headers: h, query: { site: 'demo-portfolio', name: 'Nobody' } })).statusCode, 404);

  assert.equal((await call(sites, { headers: h })).body.length, 3);
  assert.equal((await call(settings, { headers: h })).statusCode, 200);
  assert.deepEqual((await call(passkey, { headers: h })).body, []);

  // The sample data is never written to the database.
  assert.equal((await sql`select count(*)::int as n from sites where id like 'demo-%'`)[0].n, 0);
});

test('demo session cannot change or export anything, and is not an admin', async () => {
  process.env.DEMO_MODE = '1';
  const h = auth((await call(login, { method: 'POST', body: { demo: true } })).body.token);
  for (const [fn, opts] of [
    [sites, { method: 'POST', body: { name: 'X', domain: 'x.example.com' } }],
    [sites, { method: 'PATCH', query: { id: 'demo-cafe' }, body: { name: 'X', domain: 'x.example.com' } }],
    [sites, { method: 'DELETE', query: { id: 'demo-cafe' } }],
    [exportH, { query: { kind: 'backup' } }],
    [passkey, { method: 'DELETE', query: { id: 'k' } }],
  ]) assert.equal((await call(fn, { headers: h, ...opts })).statusCode, 403);
  assert.equal((await call(cleanup, { headers: h })).statusCode, 401);
});

test('demo tokens stop working when the demo is switched off, and admin tokens are unaffected', async () => {
  process.env.DEMO_MODE = '1';
  const token = (await call(login, { method: 'POST', body: { demo: true } })).body.token;
  process.env.DEMO_MODE = '0';
  assert.equal((await call(overview, { headers: auth(token), query: {} })).statusCode, 401);
  const admin = (await call(login, { method: 'POST', body: { password: 'correct horse' }, headers: { 'x-forwarded-for': '203.0.113.77' } })).body.token;
  assert.equal((await call(overview, { headers: auth(admin), query: {} })).statusCode, 200);
});

test('forged and expired demo tokens are rejected', async () => {
  process.env.DEMO_MODE = '1';
  const { token } = (await call(login, { method: 'POST', body: { demo: true } })).body;
  const [exp, , sig] = token.split('.');
  for (const t of [`${exp}.d.${sig.replace(/.$/, c => (c === 'a' ? 'b' : 'a'))}`, `${Date.now() - 1}.d.${sig}`, `${exp}.x.${sig}`, `${exp}.${sig}`])
    assert.equal((await call(overview, { headers: auth(t), query: {} })).statusCode, 401, t);
});
