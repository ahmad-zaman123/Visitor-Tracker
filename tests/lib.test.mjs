import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const lib = await import('../api/_lib.js');

test('parseUA tells devices and browsers apart', () => {
  const phone = lib.parseUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1');
  assert.deepEqual([phone.device, phone.browser, phone.bot], ['Mobile', 'Safari', false]);
  const edge = lib.parseUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0');
  assert.deepEqual([edge.device, edge.browser], ['Desktop', 'Edge']);
});

test('parseUA flags bots and previews', () => {
  for (const ua of ['Googlebot/2.1', 'HeadlessChrome/120', 'Slackbot-LinkExpanding', 'Lighthouse'])
    assert.equal(lib.parseUA(ua).bot, true, ua);
});

test('hashIp is stable, salted and never the raw address', () => {
  const a = lib.hashIp('203.0.113.9');
  assert.equal(a, lib.hashIp('203.0.113.9'));
  assert.notEqual(a, lib.hashIp('203.0.113.10'));
  assert.ok(!a.includes('203'));
  assert.equal(a.length, 16);
});

test('clip trims strings and drops everything else', () => {
  assert.equal(lib.clip('abcdef', 3), 'abc');
  assert.equal(lib.clip('', 3), null);
  assert.equal(lib.clip(42, 3), null);
  assert.equal(lib.clip(undefined, 3), null);
});

test('cleanDomain and validDomain normalise what people paste', () => {
  assert.equal(lib.cleanDomain(' https://www.My-Site.vercel.app/path?x=1 '), 'my-site.vercel.app');
  assert.ok(lib.validDomain('my-site.vercel.app'));
  assert.ok(lib.validDomain('localhost'));
  assert.ok(!lib.validDomain('not a domain'));
  assert.ok(!lib.validDomain('-bad.com'));
});

test('retentionDays never drops below 30', () => {
  process.env.RETENTION_DAYS = '3';
  assert.equal(lib.retentionDays(), 30);
  process.env.RETENTION_DAYS = '90';
  assert.equal(lib.retentionDays(), 90);
  delete process.env.RETENTION_DAYS;
  assert.equal(lib.retentionDays(), 180);
});

test('sessions verify, expire, and die when the password changes', () => {
  const { token } = lib.makeSession();
  const req = t => ({ headers: { authorization: `Bearer ${t}` } });
  assert.equal(lib.isAdmin(req(token)), true);
  assert.equal(lib.isAdmin(req(token.replace(/.$/, c => (c === 'a' ? 'b' : 'a')))), false);
  assert.equal(lib.isAdmin(req(lib.makeSession(-1).token)), false);
  assert.equal(lib.isAdmin({ headers: {} }), false);
  const old = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'something else';
  assert.equal(lib.isAdmin(req(token)), false);
  process.env.ADMIN_PASSWORD = old;
});

test('passwordOk only accepts the configured password', () => {
  assert.equal(lib.passwordOk('correct horse'), true);
  assert.equal(lib.passwordOk('wrong'), false);
  assert.equal(lib.passwordOk(undefined), false);
});

test('hasBearer compares in constant time and rejects an unset secret', () => {
  assert.equal(lib.hasBearer({ headers: { authorization: 'Bearer s3cret' } }, 's3cret'), true);
  assert.equal(lib.hasBearer({ headers: { authorization: 'Bearer nope!!' } }, 's3cret'), false);
  assert.equal(lib.hasBearer({ headers: { authorization: 'Bearer ' } }, ''), false);
  assert.equal(lib.hasBearer({ headers: {} }, undefined), false);
});
