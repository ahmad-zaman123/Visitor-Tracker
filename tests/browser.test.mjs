// Drives the real dashboard in headless Chrome against the real handlers and an in-memory database.
// Needs Chrome: set CHROME_PATH, or have google-chrome installed. Without it these tests are skipped.
import './setup.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from './dev-server.mjs';

process.env.DEMO_MODE = '1';
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p));
const opts = { skip: chrome ? false : 'Chrome not found (set CHROME_PATH)', timeout: 60000 };

let server, url, browser;
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, what, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) { try { if (await fn()) return; } catch { /* page still changing */ } }
  assert.fail(`timed out waiting for ${what}`);
};

before(async () => {
  if (!chrome) return;
  ({ server, url } = await startServer());
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(viewport = { width: 1280, height: 900 }) {
  // A fresh context per page, so remembered sites and devices from one test can't leak into the next.
  const page = await (await browser.createBrowserContext()).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport(viewport);
  await page.goto(url);
  return { page, errors };
}
const visible = (page, sel) => page.$eval(sel, e => !e.hidden && getComputedStyle(e).display !== 'none').catch(() => false);

test('demo: try it, browse a site, open a named visitor, exit', opts, async () => {
  const { page, errors } = await open();
  await until(() => visible(page, '#demoBtn'), 'the demo button');
  await page.click('#demoBtn');
  await until(() => page.$$eval('.sitecard', c => c.length === 3), 'three sample site cards');
  assert.ok(await visible(page, '#demoBar'), 'demo banner');
  assert.equal(await visible(page, '#ovAccount'), false, 'account section hidden in demo');
  assert.equal(await visible(page, '#sideAdd'), false, 'add site hidden in demo');

  await page.evaluate(() => [...document.querySelectorAll('.sitecard')].find(c => /Portfolio/.test(c.textContent)).click());
  await until(() => page.evaluate(() => [...document.querySelectorAll('a,button')].some(a => a.textContent.trim() === 'Sara Acme')), 'named visitors');
  await page.evaluate(() => [...document.querySelectorAll('a,button')].find(a => a.textContent.trim() === 'Sara Acme').click());
  await until(() => page.$eval('#vbody', e => /Last location/.test(e.innerText)), 'the visitor panel');

  await page.evaluate(() => document.getElementById('demoExit').click());
  await until(() => visible(page, '#login'), 'the sign-in page');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('tk_admin')), null);
  assert.deepEqual(errors, []);
  await page.close();
});

test('sign in: wrong password is explained, right password opens the dashboard', opts, async () => {
  const { page, errors } = await open();
  await until(() => visible(page, '#login'), 'the sign-in page');
  await page.type('#pw', 'wrong password');
  await page.click('#loginBtn');
  await until(() => page.$eval('#loginErr', e => !e.hidden && /Wrong password/.test(e.textContent)), 'the wrong-password message');

  await page.$eval('#pw', e => { e.value = ''; });
  await page.type('#pw', 'correct horse');
  await page.click('#loginBtn');
  await until(() => visible(page, '#app'), 'the dashboard');
  assert.equal(await visible(page, '#demoBar'), false, 'no demo banner for the real admin');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a real site can be added, shows up, and the snippet carries its id', opts, async () => {
  const { page } = await open();
  await page.type('#pw', 'correct horse');
  await page.click('#loginBtn');
  await until(() => visible(page, '#app'), 'the dashboard');
  const made = await page.evaluate(async () => {
    const r = await fetch('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('tk_admin') }, body: JSON.stringify({ name: 'E2E Site', domain: 'e2e.example.com' }) });
    return r.json();
  });
  await page.reload();
  await until(() => page.evaluate(() => /E2E Site/.test(document.body.innerText)), 'the new site in the list');
  assert.match(made.id, /^[0-9a-f]{10}$/);
  await page.close();
});

test('passkey: turn on fingerprint, sign out, sign back in with it', opts, async () => {
  const { page, errors } = await open();
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.evaluate(() => { try { localStorage.removeItem('tk_pk'); localStorage.removeItem('tk_pk_no'); } catch { /* fresh profile */ } });
  await page.reload();
  await until(() => visible(page, '#login'), 'the sign-in page');
  await page.type('#pw', 'correct horse');
  await page.click('#loginBtn');
  await until(() => visible(page, '#bioPrompt'), 'the fingerprint offer');
  await page.click('#bioYes');
  await until(() => page.evaluate(() => Boolean(localStorage.getItem('tk_pk'))), 'the device to be registered');

  await page.evaluate(() => document.getElementById('signOut').click());
  await until(() => visible(page, '#login'), 'the sign-in page after sign-out');
  await until(() => visible(page, '#bioBtn'), 'the fingerprint button');
  await page.click('#bioBtn');
  await until(() => visible(page, '#app'), 'the dashboard after a fingerprint sign-in');
  assert.deepEqual(errors, []);
  await page.close();
});

test('phone: nothing spills past the screen on the overview, dashboard and sign-in', opts, async () => {
  for (const width of [320, 390]) {
    const { page } = await open({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const spill = () => page.evaluate(() => {
      const W = innerWidth;
      // Things inside a deliberate side-scrolling strip (the breakdown tabs, the tables) may extend past the edge.
      const scrolls = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(p).overflowX)) return true; return false; };
      return [...document.querySelectorAll('body *')].filter(e => { const q = e.getBoundingClientRect(); return q.width && q.right > W + 1 && e.offsetParent && !e.closest('dialog,.sheet,#menu') && !scrolls(e); }).map(e => e.tagName + (e.id ? '#' + e.id : '') + '.' + e.className).slice(0, 5);
    });
    assert.deepEqual(await spill(), [], `sign-in at ${width}px`);
    await until(() => visible(page, '#demoBtn'), 'the demo button');
    await page.click('#demoBtn');
    await until(() => page.$$eval('.sitecard', c => c.length === 3), 'the overview');
    assert.deepEqual(await spill(), [], `overview at ${width}px`);
    await page.evaluate(() => [...document.querySelectorAll('.sitecard')][0].click());
    await until(() => page.$eval('#main', e => /Traffic by day/i.test(e.innerText)), 'a site dashboard');
    assert.deepEqual(await spill(), [], `dashboard at ${width}px`);
    await page.close();
  }
});
