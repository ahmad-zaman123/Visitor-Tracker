const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lsRead = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
let token = sessionStorage.getItem('tk_admin') || lsRead('tk_admin_long') || '';
let sites = [];
let timer;
// Demo sessions carry a third token part (`exp.d.sig`). They are never remembered between visits.
const isDemo = () => token.split('.').length === 3;
function paintDemo() { document.body.classList.toggle('demo', isDemo()); $('demoBar').hidden = !isDemo(); }

// ---- Theme: follows the system until the button is used, then remembers the choice.
const SUN = 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7l1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2l-1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z';
const MOON = 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z';
function curTheme() {
  return document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function paintThemeBtns() {
  const dark = curTheme() === 'dark', label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    b.setAttribute('aria-label', label); b.title = label;
    b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dark ? SUN : MOON}"/></svg>`;
  });
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
}
async function download(kind) {
  const q = kind === 'csv' ? `kind=csv&site=${encodeURIComponent($('site').value)}` : 'kind=backup';
  const r = await fetch('/api/export?' + q, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) { signOut(true); throw new Error('unauthorized'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || `export.${kind === 'csv' ? 'csv' : 'json'}`;
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// Backup card: what is in it, when this device last downloaded one, and a nudge after 30 days.
function paintBackup(nSites, nEvents) {
  if (nSites != null) $('bkInfo').textContent = `Every site and event in one JSON file, kept outside the database: ${nSites} site${nSites === 1 ? '' : 's'}${nEvents ? ' · ' + new Intl.NumberFormat().format(nEvents) + ' events' : ''}.`;
  const last = Number(lsRead('tk_backup')) || 0;
  const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  $('bkLast').textContent = last ? `Last backup from this device: ${new Date(last).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.` : '';
  $('bkNag').hidden = !(days === null || days >= 30);
  $('bkNag').textContent = days === null ? "You haven't made a backup yet. It takes a few seconds." : `It's been ${days} days since your last backup.`;
}
document.addEventListener('click', async e => {
  const x = e.target.closest('[data-export]');
  if (!x) return;
  const html = x.innerHTML;
  x.disabled = true; x.textContent = 'Preparing…'; stTop('');
  let ok = false;
  try { await download(x.dataset.export); ok = true; } catch (err) { if (err.message !== 'unauthorized') stTop(err.message || 'Could not download.'); }
  finally {
    x.disabled = false; x.innerHTML = html;
    if (ok && x.dataset.export === 'backup') {
      try { localStorage.setItem('tk_backup', String(Date.now())); } catch (er) {}
      paintBackup();
      x.querySelector('span').textContent = '✓ Downloaded';
      setTimeout(() => { x.querySelector('span').textContent = 'Download full backup'; }, 2500);
    } else if (!ok && x.dataset.export === 'backup') {
      $('bkNag').hidden = false; $('bkNag').textContent = 'Could not download the backup. Check your connection and try again.';
    }
  }
});
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'make-link') { $('linkCard').open = true; $('lkName').scrollIntoView({ block: 'center', behavior: 'smooth' }); $('lkName').focus({ preventScroll: true }); }
  else if (a.dataset.act === 'show-install') $('firstRun').scrollIntoView({ block: 'center', behavior: 'smooth' });
  else if (a.dataset.act === 'copy-snippet') {
    await copyText(a.dataset.text);
    a.textContent = 'Copied';
    setTimeout(() => { a.textContent = 'Copy snippet'; }, 1500);
  }
});
document.addEventListener('click', e => {
  if (!e.target.closest('[data-theme-toggle]')) return;
  const next = curTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch {}
  paintThemeBtns();
});
paintThemeBtns();

// ---- Loading, errors, "updated" stamp.
let lastUpdated = 0, loadSeq = 0, wantSite = null, settingsOpen = false, stDirty = false, lastSettings = null;
const since = ms => { const s = Math.floor(ms / 1000); return s < 5 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : Math.floor(s / 3600) + 'h ago'; };
function paintUpdated() {
  $('updated').textContent = lastUpdated ? 'Updated ' + since(Date.now() - lastUpdated) + (paused ? ' · paused' : '') : '';
  $('updated').title = lastUpdated ? new Date(lastUpdated).toLocaleString() : '';
}
setInterval(paintUpdated, 10000);

function showBanner(msg) {
  document.querySelector('main').classList.toggle('failed', Boolean(msg) && !lastUpdated);
  $('banner').hidden = !msg;
  $('bannerMsg').textContent = msg;
}
function errText(e) {
  const when = lastUpdated ? ` Showing data from ${new Date(lastUpdated).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.` : '';
  return (e instanceof TypeError ? "Can't reach the server. Check your connection." : `The server returned an error (${e.message}).`) + when;
}
// soft = keep the numbers on screen and only pulse; otherwise blank them while the new data loads.
function setLoading(on, soft) {
  document.querySelector('main').classList.toggle('is-loading', on);
  if (on && !soft) {
    ['sViews', 'sVisitors', 'sNamed', 'sLive', 'oViews', 'oVisitors', 'oNamed', 'oLive'].forEach(id => { $(id).textContent = '–'; });
    ['dViews', 'dVisitors', 'dNamed', 'dOViews', 'dOVisitors', 'dONamed'].forEach(id => { $(id).textContent = ''; });
  }
}

// ---- Remember the view: site, range and filters live in the URL, with the last site and range kept as a fallback.
function syncUrl(push, state) {
  const site = $('site').value;
  const u = new URLSearchParams();
  if (site) u.set('site', site === ALL ? 'all' : site);
  if (settingsOpen && site && site !== ALL) u.set('view', 'settings');
  if (days !== 30) u.set('range', days);
  if (nm.q.trim()) u.set('q', nm.q.trim());
  if (rc.who !== 'all') u.set('who', rc.who);
  if (rc.event !== 'all') u.set('event', rc.event);
  if (rc.country !== 'all') u.set('country', rc.country);
  const qs = u.toString();
  const url = location.pathname + (qs ? '?' + qs : '') + (push ? '' : location.hash);
  if (push && url !== location.pathname + location.search) history.pushState(state || null, '', url);
  else history.replaceState(push ? state || null : history.state, '', url);
  try { localStorage.setItem('tk_view', JSON.stringify({ site: site === ALL ? 'all' : site, days })); } catch {}
}
function initFromUrl() {
  const u = new URLSearchParams(location.search);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('tk_view') || '{}'); } catch {}
  const range = Number(u.get('range') || (u.has('site') ? 30 : saved.days));
  if (Number.isInteger(range) && range >= 1 && range <= 365) days = range;
  paintRange();
  wantSite = u.get('site') || (u.has('range') ? null : saved.site) || null;
  settingsOpen = u.get('view') === 'settings';
  nm.q = u.get('q') || '';
  $('nmSearch').value = nm.q;
  if (['named', 'anon'].includes(u.get('who'))) rc.who = u.get('who');
  rc.event = u.get('event') || 'all';
  rc.country = u.get('country') || 'all';
  document.querySelectorAll('#rcWho button').forEach(b => b.classList.toggle('on', b.dataset.v === rc.who));
}

// The last good answer for each view is kept on this device, so with no signal the app can still show it.
const CACHEABLE = /^\/api\/(stats|overview|sites|settings|visitor)(\?|$)/;
let offlineAt = 0;
const cacheKey = p => 'tk_c:' + p;
function cachePut(path, data) {
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify({ t: Date.now(), data }));
    const keys = Object.keys(localStorage).filter(k => k.startsWith('tk_c:'));
    if (keys.length > 24) keys.map(k => [k, JSON.parse(localStorage.getItem(k) || '{}').t || 0]).sort((a, b) => a[1] - b[1]).slice(0, keys.length - 24).forEach(([k]) => localStorage.removeItem(k));
  } catch (e) { /* storage full or blocked: carry on without it */ }
}
function cacheGet(path) { try { return JSON.parse(localStorage.getItem(cacheKey(path)) || 'null'); } catch (e) { return null; } }
function cacheClear() { try { Object.keys(localStorage).filter(k => k.startsWith('tk_c:')).forEach(k => localStorage.removeItem(k)); } catch (e) {} }

async function api(path, opts = {}) {
  const cacheable = (!opts.method || opts.method === 'GET') && CACHEABLE.test(path);
  let r;
  try {
    r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...opts.headers } });
  } catch (e) {
    const hit = cacheable && e instanceof TypeError ? cacheGet(path) : null;
    if (!hit) throw e;
    offlineAt = Math.max(offlineAt, hit.t);
    return hit.data;
  }
  if (r.status === 401) { signOut(true); throw new Error('unauthorized'); }
  if (!r.ok && r.status !== 204) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  const data = r.status === 204 ? null : await r.json();
  if (cacheable && data) cachePut(path, data);
  return data;
}

// On a phone, focusing the field opens the keyboard over the card (and over the fingerprint button), so skip it on touch-first devices.
const touchFirst = () => Boolean(window.matchMedia) && matchMedia('(pointer: coarse)').matches;
function focusPw(select) { if (touchFirst()) return; $('pw').focus(); if (select) $('pw').select(); }

function signOut(expired) {
  cacheClear(); token = ''; paintDemo(); sessionStorage.removeItem('tk_admin'); try { localStorage.removeItem('tk_admin_long'); } catch (e) {} clearInterval(timer); lastUpdated = 0; showBanner('');
  $('app').hidden = true; $('login').hidden = false;
  $('pw').value = ''; focusPw();
  if (expired === true) bioAuto = true;
  paintBio();
  clearLogin();
  if (expired === true) loginError('Your session ended. Sign in again.');
  else { $('loginNote').textContent = "You've been signed out."; $('loginNote').hidden = false; }
}

$('pwToggle').onclick = () => {
  const show = $('pw').type === 'password';
  $('pw').type = show ? 'text' : 'password';
  // SVG elements have no .hidden property, so the attribute has to be set directly.
  $('pwToggle').querySelector('.i-show').toggleAttribute('hidden', show); $('pwToggle').querySelector('.i-hide').toggleAttribute('hidden', !show);
  $('pwToggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  $('pwToggle').setAttribute('aria-pressed', String(show));
};
function setBusy(on) {
  $('loginBtn').disabled = on; $('loginBtn').classList.toggle('busy', on);
  $('loginBtnTxt').textContent = on ? 'Signing in…' : 'Sign in';
}
// A short blink of the logo before the dashboard appears. Skipped for people who prefer less motion.
async function opening() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const l = document.querySelector('.logo'); l.classList.remove('opening'); void l.offsetWidth; l.classList.add('opening');
  await new Promise(r => setTimeout(r, 400));
}
function loginError(text, shake) {
  $('loginErr').textContent = text; $('loginErr').hidden = false; $('loginNote').hidden = true;
  $('pw').setAttribute('aria-invalid', 'true');
  if (shake) { const c = document.querySelector('.logincard'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
}
function clearLogin() { $('loginErr').hidden = true; $('loginNote').hidden = true; $('pw').removeAttribute('aria-invalid'); }
$('pw').addEventListener('input', clearLogin);
const caps = e => { $('capsNote').hidden = !(e.getModifierState && e.getModifierState('CapsLock')); };
$('pw').addEventListener('keydown', caps); $('pw').addEventListener('keyup', caps);
$('pw').addEventListener('blur', () => { $('capsNote').hidden = true; });
$('login').onsubmit = async e => {
  e.preventDefault();
  clearLogin();
  setBusy(true);
  try {
    const remember = $('remember').checked;
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('pw').value, remember }) });
    if (r.status === 429) { const m = Math.ceil(Number(r.headers.get('Retry-After') || 900) / 60); throw new Error('locked:' + m); }
    if (r.status === 401) { const j = await r.json().catch(() => ({})); throw new Error('wrong:' + (j.left ?? '')); }
    if (!r.ok) throw new Error(r.statusText || r.status);
    token = (await r.json()).token;
    sites = await api('/api/sites');
    if (remember) { try { localStorage.setItem('tk_admin_long', token); } catch (e) { sessionStorage.setItem('tk_admin', token); } } else sessionStorage.setItem('tk_admin', token);
    await opening(); start(); offerBio();
  } catch (err) {
    const m = err.message || '';
    loginError(m.startsWith('wrong:') ? 'Wrong password.' + (m.slice(6) !== '' && Number(m.slice(6)) <= 3 ? ` ${m.slice(6)} ${m.slice(6) === '1' ? 'try' : 'tries'} left before a short lockout.` : ' Try again.')
      : m.startsWith('locked:') ? `Too many wrong tries. Try again in ${m.slice(7)} minute${m.slice(7) === '1' ? '' : 's'}.`
      : err instanceof TypeError ? "Can't reach the server. Check your connection." : `Something went wrong (${m}).`, m.startsWith('wrong:'));
    focusPw(true);
  } finally { setBusy(false); }
};
$('signOut').onclick = () => { bioAuto = false; signOut(); };
$('demoExit').onclick = () => $('signOut').click();
// Offer the demo only when the server has it switched on.
fetch('/api/login').then(r => r.ok ? r.json() : null).then(j => { if (j?.demo) $('demoBtn').hidden = false; }).catch(() => {});
$('demoBtn').onclick = async () => {
  clearLogin(); $('demoBtn').disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ demo: true }) });
    if (!r.ok) throw new Error(r.status);
    token = (await r.json()).token; sessionStorage.setItem('tk_admin', token);
    sites = await api('/api/sites'); await opening(); start();
  } catch (err) { token = ''; loginError("Couldn't open the demo. Try again in a moment."); }
  finally { $('demoBtn').disabled = false; }
};

async function start() {
  $('login').hidden = true; $('app').hidden = false; paintDemo();
  await loadSites();
  pinRange(); setTimeout(pinRange, 300);
  clearInterval(timer);
  timer = setInterval(() => {
    // Don't move the page under someone who paused, has another tab in front, or is reading a panel or dialog.
    if (paused || document.hidden || !$('vpanel').hidden || document.querySelector('dialog[open]')) return;
    refreshSites(); load({ quiet: true });
  }, 30000);
}

const ALL = '__all';
function pinRange() {
  const h = document.querySelector('header'), r = $('range');
  const phone = matchMedia('(max-width: 640px)').matches && r.offsetParent !== null;
  h.style.setProperty('--hdr-top', phone ? -(r.offsetTop - 8) + 'px' : '0px');
}
addEventListener('resize', pinRange);
new MutationObserver(pinRange).observe(document.body, { attributes: true, attributeFilter: ['class'] });
let paused = lsRead('tk_paused') === '1';
function paintPause() { $('pauseBtn').textContent = paused ? '▶ Resume' : '⏸ Pause'; $('pauseBtn').setAttribute('aria-pressed', paused); $('pauseBtn').title = paused ? 'Resume refreshing every 30 seconds' : 'Stop the page refreshing itself every 30 seconds'; }
$('pauseBtn').onclick = () => { paused = !paused; paintUpdated(); try { localStorage.setItem('tk_paused', paused ? '1' : '0'); } catch (e) {} paintPause(); if (!paused) load({ quiet: true }); };
paintPause();

const compact = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n));
function paintSidebar() {
  const cur = $('site').value;
  const items = sites.length > 1 ? [{ id: ALL, name: 'All sites', sub: `${sites.length} sites`, n: sites.reduce((a, s) => a + Number(s.views_30d), 0), live: sites.reduce((a, s) => a + Number(s.live || 0), 0) }] : [];
  sites.forEach(s => items.push({ id: s.id, name: s.name, sub: s.domain, n: Number(s.views_30d), live: Number(s.live || 0) }));
  $('sideList').innerHTML = items.map(i => `<button type="button" class="sideitem${i.id === cur ? ' on' : ''}" data-id="${esc(i.id)}"${i.id === cur ? ' aria-current="page"' : ''}><span class="si-text"><b>${esc(i.name)}</b><small>${esc(i.sub)}</small></span><span class="si-n" title="Page views in the last 30 days">${i.live ? `<span class="si-live">● ${i.live} · </span>` : ''}${compact(i.n)}</span></button>`).join('');
  $('sheetList').innerHTML = $('sideList').innerHTML;
  const curItem = items.find(i => i.id === cur);
  $('siteBtnTxt').textContent = curItem ? curItem.name : 'Sites';
  const online = sites.reduce((a, x) => a + Number(x.live || 0), 0);
  $('liveDot').hidden = $('liveDot2').hidden = !online;
  $('liveDot').title = $('liveDot2').title = `${online} online right now`;
  const one = cur && cur !== ALL ? curItem?.name : '';
  $('hSite').textContent = one || '';
  document.title = one ? `${one} · Visitor Tracker` : 'Visitor Tracker';
}
// Rebuilds the dropdown (phones) and the sidebar (wide screens) from `sites`, keeping the current choice.
function renderSiteList() {
  const cur = $('site').value;
  const all = sites.length > 1 ? `<option value="${ALL}">All sites</option>` : '';
  $('site').innerHTML = all + sites.map(s => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.domain)})</option>`).join('');
  if ([...$('site').options].some(o => o.value === cur)) $('site').value = cur;
  paintSidebar();
}
async function refreshSites() {
  try { sites = await api('/api/sites'); renderSiteList(); } catch { /* the main refresh reports connection problems */ }
}
function selectSite(id) {
  $('site').value = id;
  settingsOpen = false;
  updateLink(); resetFilters(); syncUrl(true); paintSidebar(); load();
}
$('site').onchange = () => selectSite($('site').value);
$('sideList').addEventListener('click', e => { const b = e.target.closest('.sideitem'); if (b) selectSite(b.dataset.id); });
$('siteBtn').onclick = () => { paintSidebar(); $('siteSheet').showModal(); $('sheetList').querySelector('.sideitem.on')?.scrollIntoView({ block: 'nearest' }); };
$('sheetList').addEventListener('click', e => { const b = e.target.closest('.sideitem'); if (b) { $('siteSheet').close(); selectSite(b.dataset.id); } });
$('siteSheet').addEventListener('click', e => { if (e.target === $('siteSheet')) $('siteSheet').close(); });

// Account menu (all screen sizes): new link, add site, theme, shortcuts, sign out.
async function newLink() {
  if (!$('site').value || $('site').value === ALL) return;
  if (settingsOpen) { $('stBtn').click(); for (let i = 0; i < 30 && $('dash').hidden; i++) await new Promise(r => setTimeout(r, 100)); }
  $('linkCard').open = true;
  $('linkCard').scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('lkName').focus({ preventScroll: true });
}
$('sideAdd').onclick = () => $('addBtn').click();
$('kbClose').onclick = () => $('kbDlg').close();
function closeMenu() { $('menu').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
$('menuBtn').onclick = e => {
  e.stopPropagation();
  if (!$('menu').hidden) return closeMenu();
  const dark = curTheme() === 'dark';
  const single = $('site').value && $('site').value !== ALL;
  document.querySelector('#menu [data-m=link]').hidden = !single;
  document.querySelector('#menu [data-m=keys]').hidden = matchMedia('(pointer: coarse)').matches;
  document.querySelector('#menu [data-m=theme]').textContent = dark ? '☀ Switch to light mode' : '☾ Switch to dark mode';
  $('menu').style.top = ($('menuBtn').getBoundingClientRect().bottom + 6) + 'px';
  $('menu').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true');
  $('menu').querySelector('button').focus();
};
$('menu').onclick = e => {
  const b = e.target.closest('[data-m]');
  if (!b) return;
  closeMenu();
  if (b.dataset.m === 'add') $('addBtn').click();
  else if (b.dataset.m === 'link') newLink();
  else if (b.dataset.m === 'keys') $('kbDlg').showModal();
  else if (b.dataset.m === 'theme') document.querySelector('header .theme-toggle').click();
  else $('signOut').click();
};
document.addEventListener('click', e => { if (!$('menu').hidden && !e.target.closest('#menu')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('menu').hidden) { closeMenu(); $('menuBtn').focus(); } });
addEventListener('scroll', () => { if (!$('menu').hidden) closeMenu(); }, { passive: true });

async function loadSites(selectId) {
  sites = await api('/api/sites');
  renderSiteList();
  const h = !selectId && hashTarget();
  const fromUrl = wantSite === 'all' ? (sites.length > 1 ? ALL : null) : (sites.some(x => x.id === wantSite) ? wantSite : null);
  wantSite = null;
  const want = selectId || (h && sites.some(x => x.id === h.site) ? h.site : null) || fromUrl || (sites.length > 1 ? ALL : sites[0]?.id);
  if (want) $('site').value = want;
  if (selectId || !$('site').value || $('site').value === ALL) settingsOpen = false;
  paintSidebar();
  updateLink();
  if (selectId) resetFilters();
  syncUrl();
  await load();
  if (!selectId) openFromHash();
}

// Jump from the overview into one site, optionally straight to a visitor's timeline.
async function goSite(id, name) {
  $('site').value = id;
  settingsOpen = false;
  paintSidebar();
  updateLink(); resetFilters(); syncUrl(true);
  await load();
  if (name) openVisitor(name);
}

const domainOk = d => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$|^localhost$/.test(d);
const cleanDomain = v => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '').replace(/^www\./, '');
const snippetFor = id => `<script defer src="${location.origin}/t.js" data-site="${id}"><\/script>`;
const adErr = msg => { $('adErr').textContent = msg || ''; $('adErr').hidden = !msg; };

$('addBtn').onclick = () => {
  $('addForm').reset(); adErr('');
  $('addStep1').hidden = false; $('addStep2').hidden = true;
  $('adSubmit').disabled = false; $('adSubmit').textContent = 'Add site';
  $('addDlg').showModal();
  $('adName').focus();
};
$('adCancel').onclick = () => $('addDlg').close();
$('adDone').onclick = () => $('addDlg').close();

$('addForm').onsubmit = async e => {
  e.preventDefault();
  const name = $('adName').value.trim();
  const domain = cleanDomain($('adDomain').value);
  if (!name) { adErr('Give the site a name.'); $('adName').focus(); return; }
  if (!domainOk(domain)) {
    adErr('Enter a domain like mysite.vercel.app.'); $('adDomain').focus(); return;
  }
  adErr(''); $('adSubmit').disabled = true; $('adSubmit').textContent = 'Adding…';
  try {
    const s = await api('/api/sites', { method: 'POST', body: JSON.stringify({ name, domain }) });
    $('adDom').textContent = s.domain;
    $('adSnippet').textContent = snippetFor(s.id);
    $('addStep1').hidden = true; $('addStep2').hidden = false;
    $('adCopy').focus();
    loadSites(s.id);
  } catch (err) {
    adErr(err.message || 'Could not add the site.');
    $('adSubmit').disabled = false; $('adSubmit').textContent = 'Add site';
  }
};

$('adCopy').onclick = async () => {
  const text = $('adSnippet').textContent;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const r = document.createRange(); r.selectNodeContents($('adSnippet'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy');
  }
  $('adCopy').textContent = 'Copied';
  setTimeout(() => { $('adCopy').textContent = 'Copy snippet'; }, 1500);
};
let days = 30;
const PRESETS = [1, 7, 30, 90];
function paintRange() {
  document.querySelectorAll('#range button[data-days]').forEach(b => { const on = Number(b.dataset.days) === days; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const custom = !PRESETS.includes(days);
  $('rngCustom').textContent = custom ? `${days}d` : 'Custom';
  $('rngCustom').classList.toggle('on', custom); $('rngCustom').setAttribute('aria-pressed', custom);
}
$('range').onclick = e => {
  const b = e.target.closest('button[data-days]');
  if (!b) return;
  days = Number(b.dataset.days);
  paintRange(); syncUrl(); load();
};
$('rngCustom').onclick = () => { $('rgDays').value = PRESETS.includes(days) ? '' : days; $('rngDlg').showModal(); $('rgDays').focus(); };
$('rgCancel').onclick = () => $('rngDlg').close();
$('rgForm').onsubmit = e => {
  e.preventDefault();
  const n = Math.round(Number($('rgDays').value));
  if (!(n >= 1 && n <= 365)) { $('rgDays').setCustomValidity('Enter a number from 1 to 365'); $('rgDays').reportValidity(); return; }
  $('rgDays').setCustomValidity('');
  days = n; $('rngDlg').close(); paintRange(); syncUrl(); load();
};
$('rgDays').oninput = () => $('rgDays').setCustomValidity('');

// Friendlier wording for the raw event and page names the snippet records.
const EV_ICON = { 'clicked-email': '✉', 'clicked-phone': '☎' };
function evLabel(e) {
  if (e === 'pageview') return 'Viewed page';
  if (e === 'identify') return 'Identified';
  if (e === 'clicked-email') return '✉ Clicked email';
  if (e === 'clicked-phone') return '☎ Clicked phone';
  if (e.startsWith('downloaded-')) return '⬇ Downloaded ' + e.slice(11);
  if (e.startsWith('outbound-')) return '↗ Opened link to ' + e.slice(9);
  return e;
}
// "/#plain" reads better as "/ (plain)".
const pageLabel = p => { p = p || '/'; const i = p.indexOf('#'); return i < 0 ? p : (p.slice(0, i) || '/') + (p.slice(i + 1) ? ` (${p.slice(i + 1)})` : ''); };
const bars = (rows, fmt = x => x) => {
  if (!rows.length) return '<div class="empty">Nothing in this range yet.</div>';
  const max = Math.max(...rows.map(r => r.n));
  return rows.map(r => `<div class="row"><i style="width:${(r.n / max) * 100}%"></i><span title="${esc(fmt(r.label))}">${esc(fmt(r.label))}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><span class="n">${r.n}</span></div>`).join('');
};
const ago = t => {
  const s = Math.max(1, (Date.now() - new Date(t)) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago';
};
// Country codes become names with a flag. Flag emoji show as plain letters on Windows, which is still readable.
const regionNames = (() => { try { return new Intl.DisplayNames(undefined, { type: 'region' }); } catch { return null; } })();
const flagOf = c => (/^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65)) : '');
function countryName(c) {
  if (!c || c === '??') return 'Unknown';
  try { return regionNames?.of(c) || c; } catch { return c; }
}
const countryLabel = c => [flagOf(c), countryName(c)].filter(Boolean).join(' ');
const place = r => {
  const where = [r.city, r.country ? countryName(r.country) : ''].filter(Boolean).join(', ');
  return where ? [flagOf(r.country), where].filter(Boolean).join(' ') : '-';
};

// A relative time that shows the exact time on hover.
const agoEl = t => `<time datetime="${esc(t)}" title="${esc(new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }))}">${esc(ago(t))}</time>`;

async function load({ quiet = false, soft = false } = {}) {
  const seq = ++loadSeq;
  offlineAt = 0;
  if (!quiet) setLoading(true, soft);
  $('refreshBtn').disabled = true; $('refreshBtn').textContent = '↻ Refreshing…';
  try {
    await loadView(seq);
    if (seq === loadSeq) {
      lastUpdated = offlineAt || Date.now();
      showBanner(offlineAt ? `Offline. Showing data saved at ${new Date(offlineAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.` : '');
      paintUpdated();
    }
  } catch (e) {
    if (e.message !== 'unauthorized' && seq === loadSeq) showBanner(errText(e));
  } finally {
    if (seq === loadSeq) { setLoading(false); $('refreshBtn').disabled = false; $('refreshBtn').textContent = '↻ Refresh'; }
  }
}
$('refreshBtn').onclick = () => { refreshSites(); load({ soft: true }); };
$('retryBtn').onclick = () => load();

async function loadView(seq) {
  const id = $('site').value;
  document.body.classList.remove('in-settings');
  if (!id) { $('dash').hidden = true; $('overview').hidden = true; $('settings').hidden = true; $('stBtn').hidden = true; $('setup').hidden = false;
    $('setup').innerHTML = '<h2>Get started</h2><p>Add your first site with <b>+ Add site</b>, then paste the snippet it gives you into that site\'s HTML.</p>'; return; }
  $('setup').hidden = true;
  $('stBtn').hidden = id === ALL;
  document.body.classList.toggle('in-settings', id !== ALL && settingsOpen);
  $('stBtn').textContent = settingsOpen ? '← Dashboard' : '⚙ Site settings';
  if (id !== ALL && settingsOpen) { $('dash').hidden = true; $('overview').hidden = true; $('settings').hidden = false; return loadSettings(id, seq); }
  $('settings').hidden = true;
  if (id === ALL) { $('dash').hidden = true; $('overview').hidden = false; return loadOverview(seq); }
  $('overview').hidden = true; $('dash').hidden = false;
  updateLink();
  const d = await api(`/api/stats?site=${id}&days=${days}`);
  if (seq !== loadSeq) return;

  $('sViews').textContent = d.totals.views;
  $('sVisitors').textContent = d.totals.visitors;
  $('sNamed').textContent = d.totals.named;
  $('sLive').textContent = d.live;
  const vs = d.days === 1 ? 'previous 24 hours' : `previous ${d.days} days`;
  $('dViews').innerHTML = delta(d.totals.views, d.prev.views, vs);
  $('dVisitors').innerHTML = delta(d.totals.visitors, d.prev.visitors, vs);
  $('dNamed').innerHTML = delta(d.totals.named, d.prev.named, vs);
  $('chartTitle').textContent = d.days === 1 ? 'Traffic by hour' : 'Traffic by day';
  renderChart(d);

  // A site that has never received an event gets a setup card instead of a wall of zeros.
  const never = d.totals.views === 0 && d.recent.length === 0;
  $('firstRun').hidden = !never;
  if (never) {
    const site = sites.find(x => x.id === id);
    $('firstRun').innerHTML = `<h2>Waiting for the first visit</h2>
      <p style="margin:0 0 8px">Paste this before <code>&lt;/body&gt;</code> on <b>${esc(site?.domain || '')}</b>, deploy, then open the site once.</p>
      <div class="snippet">${esc(snippetFor(id))}</div>
      <button data-act="copy-snippet" data-text="${esc(snippetFor(id))}">Copy snippet</button>`;
  }

  lastData = d;
  renderNamed();

  $('paths').innerHTML = bars(d.paths, pageLabel);
  $('referrers').innerHTML = bars(d.referrers);
  $('countries').innerHTML = bars(d.countries, countryLabel);
  $('devices').innerHTML = bars(d.devices);
  $('custom').innerHTML = bars(d.custom, evLabel);
  $('customCard').hidden = !d.custom.length;
  $('campaigns').innerHTML = d.campaigns.length
    ? bars(d.campaigns.map(c => ({ ...c, sub: c.acted ? `${c.acted} downloaded or contacted` : '' })))
    : '<div class="empty">No tagged visits yet. Make a link below with “Shared on” filled in, or add <code>?utm_source=linkedin</code> to any link.</div>';

  fillRecentFilters();
  renderRecent();
}

const fmtDate = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const fmtDayOnly = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtFull = t => `${fmtDate(t)}, ${fmtTime(t)}`;
const dur = ms => { const m = Math.round(ms / 60000); return m < 1 ? '<1 min' : m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
let lastFocus = null;

// ---- Confirmation dialog. With requireText the user has to type that text before the button unlocks.
function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, requireText = '' }) {
  return new Promise(resolve => {
    const dlg = $('confirmDlg');
    let result = false;
    $('cfTitle').textContent = title;
    $('cfMsg').textContent = message;
    $('cfOk').textContent = confirmText;
    $('cfOk').className = danger ? 'danger' : 'primary';
    $('cfOk').disabled = Boolean(requireText);
    $('cfTypeWrap').hidden = !requireText;
    $('cfWord').textContent = requireText;
    $('cfInput').value = '';
    $('cfInput').oninput = () => { $('cfOk').disabled = $('cfInput').value.trim().toLowerCase() !== requireText.toLowerCase(); };
    $('cfOk').onclick = () => { result = true; dlg.close(); };
    $('cfCancel').onclick = () => dlg.close();
    dlg.addEventListener('close', () => resolve(result), { once: true });
    dlg.showModal();
    (requireText ? $('cfInput') : $('cfCancel')).focus();
  });
}

// ---- Site settings
const stTop = (text, ok) => { $('stTop').hidden = !text; $('stTop').textContent = text || ''; $('stTop').className = ok ? 'msg-ok' : 'msg-err'; };
const dzMsg = (text, ok) => { $('stDzMsg').hidden = !text; $('stDzMsg').textContent = text || ''; $('stDzMsg').className = ok ? 'msg-ok' : 'msg-err'; };
const stMsg = (text, ok) => { $('stMsg').hidden = !text; $('stMsg').textContent = text || ''; $('stMsg').className = ok ? 'msg-ok' : 'msg-err'; };
function stCheckDirty() {
  const site = sites.find(x => x.id === $('site').value);
  stDirty = Boolean(site) && ($('stName').value.trim() !== site.name || cleanDomain($('stDomain').value) !== site.domain);
  $('stSave').disabled = !stDirty;
}
$('stName').oninput = $('stDomain').oninput = stCheckDirty;

async function loadSettings(id, seq) {
  const d = await api('/api/settings');
  if (seq !== loadSeq) return;
  const site = sites.find(x => x.id === id);
  if (!site) return;
  lastSettings = d;
  $('stTitle').textContent = `Settings · ${site.name}`;
  if (!stDirty) { $('stName').value = site.name; $('stDomain').value = site.domain; $('stSave').disabled = true; }
  $('stId').textContent = site.id;
  $('stSnippet').textContent = snippetFor(id);
  $('stTip').innerHTML = `Name a visitor by sending <code>https://${esc(site.domain)}/?ref=Sara-Acme</code>. Log actions with <code>tracker.track('clicked-resume')</code>.`;
  $('stCopy').dataset.text = snippetFor(id);
  const st = d.sites.find(x => x.site_id === id);
  const since = st?.oldest ? `, going back to ${new Date(st.oldest).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  const total = st?.total ?? 0;
  $('stData').innerHTML = `<p style="margin-top:0"><b>${new Intl.NumberFormat().format(total)}</b> events stored${esc(since)}.</p>
    <p>Events are kept for <b>${d.retentionDays} days</b>${d.cronConfigured ? '. Older ones are deleted automatically every day at 03:00 UTC' : ', but automatic deletion is off right now'}.
      <span class="hint" style="display:block;margin-top:4px">To change this, set <code>RETENTION_DAYS</code> (30 or more) in Vercel and redeploy.</span></p>
    <div class="exports"><button type="button" data-export="csv"${total ? '' : ' disabled'}>Download this site's events (CSV)</button></div>
    <p class="hint" style="margin:8px 0 0">Opens in Excel or Google Sheets.</p>`;
}

$('stBtn').onclick = () => {
  if (settingsOpen && history.state?.st) { history.back(); return; }
  settingsOpen = !settingsOpen; stDirty = false; stMsg(''); stTop(''); dzMsg('');
  syncUrl(settingsOpen, settingsOpen ? { st: 1 } : null); load();
};

$('stForm').onsubmit = async e => {
  e.preventDefault();
  const id = $('site').value;
  const name = $('stName').value.trim();
  const domain = cleanDomain($('stDomain').value);
  if (!name) { stMsg('Give the site a name.'); $('stName').focus(); return; }
  if (!domainOk(domain)) { stMsg('Enter a domain like mysite.vercel.app.'); $('stDomain').focus(); return; }
  $('stSave').disabled = true; $('stSave').textContent = 'Saving…'; stMsg('');
  try {
    const row = await api('/api/sites?id=' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ name, domain }) });
    sites = sites.map(x => (x.id === id ? { ...x, name: row.name, domain: row.domain } : x));
    renderSiteList(); updateLink();
    $('stName').value = row.name; $('stDomain').value = row.domain; $('stTitle').textContent = `Settings · ${row.name}`;
    stDirty = false;
    stMsg('✓ Saved. Your changes are live.', true);
  } catch (err) {
    stMsg(err.message || 'Could not save.');
    stCheckDirty();
  } finally { $('stSave').textContent = 'Save changes'; }
};

document.addEventListener('click', e => {
  const j = e.target.closest('[data-jump]');
  if (j) $(j.dataset.jump).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
$('stIdCopy').onclick = async () => {
  await copyText($('stId').textContent);
  $('stIdCopy').textContent = 'Copied'; setTimeout(() => { $('stIdCopy').textContent = 'Copy'; }, 1500);
};
$('stClear').onclick = async () => {
  const id = $('site').value;
  const site = sites.find(x => x.id === id);
  if (!site) return;
  const total = lastSettings?.sites.find(x => x.site_id === id)?.total ?? 0;
  dzMsg('');
  const ok = await confirmDialog({
    title: `Clear all visits for ${site.name}?`,
    message: `This permanently deletes ${total ? 'all ' + new Intl.NumberFormat().format(total) + ' recorded events' : 'every recorded event'} for this site. The site and its install snippet stay. This can't be undone.`,
    confirmText: 'Clear visits', danger: true, requireText: site.name,
  });
  if (!ok) return;
  try {
    await api('/api/sites?id=' + encodeURIComponent(id) + '&events=1', { method: 'DELETE' });
    dzMsg('✓ All visits cleared.', true);
    refreshSites(); load({ quiet: true });
  } catch (err) { dzMsg(err.message || 'Could not clear the visits.'); }
};
$('stDelete').onclick = async () => {
  const id = $('site').value;
  const site = sites.find(x => x.id === id);
  if (!site) return;
  const total = lastSettings?.sites.find(x => x.site_id === id)?.total ?? 0;
  const ok = await confirmDialog({
    title: `Delete ${site.name}?`,
    message: `This permanently deletes the site and ${total ? 'all ' + new Intl.NumberFormat().format(total) + ' events' : 'its data'}. This can't be undone.`,
    confirmText: 'Delete site', danger: true, requireText: site.name,
  });
  if (!ok) return;
  try {
    await api('/api/sites?id=' + encodeURIComponent(id), { method: 'DELETE' });
    settingsOpen = false; stDirty = false;
    await loadSites();
  } catch (err) { dzMsg(err.message || 'Could not delete the site.'); }
};

let ovData = null, ovVs = '', ovFlip = false, ovAllRecent = false;
const ovMode = () => lsRead('tk_ovview') || ((ovData && ovData.sites.length > 4 && matchMedia('(max-width:640px)').matches) ? 'list' : 'cards');
const lowVol = (c, p) => c < 10 && p < 10;
// The change since the previous period, as a small coloured pill.
function ovPill(x) {
  if (!x.last_seen || (!x.totals.views && !x.prev.views)) return '';
  const c = x.totals.views, p = x.prev.views, tip = `vs ${ovVs}`;
  if (lowVol(c, p)) return `<span class="pill" title="Too few views to compare">low volume</span>`;
  if (!p) return `<span class="pill up" title="${tip}">new</span>`;
  const pc = Math.round(((c - p) / p) * 100);
  if (pc === 0) return `<span class="pill" title="${tip}">no change</span>`;
  return `<span class="pill ${pc > 0 ? 'up' : 'down'}" title="${tip}">${pc > 0 ? '▲' : '▼'} ${Math.abs(pc)}%</span>`;
}
const ovTable = () => ovMode() === 'list' && matchMedia('(min-width: 641px)').matches;
matchMedia('(min-width: 641px)').addEventListener?.('change', () => renderCards());

function renderCards() {
  const d = ovData; if (!d) return;
  const mode = ovMode(), table = ovTable(), sort = $('ovSort').value;
  $('ovCards').setAttribute('aria-pressed', mode === 'cards'); $('ovList').setAttribute('aria-pressed', mode === 'list');
  $('ovSortWrap').hidden = table;
  const chg = x => (x.totals.views - x.prev.views) / Math.max(x.prev.views, 1);
  const cmp = {
    views: (p, q) => q.totals.views - p.totals.views,
    recent: (p, q) => new Date(q.last_seen) - new Date(p.last_seen),
    change: (p, q) => chg(q) - chg(p),
    name: (p, q) => p.name.localeCompare(q.name),
  }[sort];
  // Sites with no visits stay at the bottom whichever way it is sorted.
  const list = [...d.sites].sort((p, q) => (!p.last_seen - !q.last_seen) || (ovFlip ? -1 : 1) * cmp(p, q));
  const total = d.sites.reduce((a, x) => a + x.totals.views, 0);
  const share = x => (total ? Math.round((x.totals.views / total) * 100) : 0);
  const shareT = x => (x.totals.views && share(x) < 1 ? '<1' : share(x));
  const grid = $('siteGrid');
  grid.classList.toggle('list', mode === 'list' && !table); grid.classList.toggle('tbl', table);
  if (!list.length) { grid.innerHTML = '<div class="empty">No sites yet.</div>'; return; }
  const sparkOf = (x, cls = '') => {
    const { rows } = fillBuckets(x.daily, d.days);
    const max = Math.max(1, ...rows.map(r => r.views));
    return `<div class="spark ${cls}" aria-hidden="true">${rows.map(r => `<i style="height:${(r.views / max) * 100}%"></i>`).join('')}</div>`;
  };
  const stale = x => x.last_seen && (Date.now() - new Date(x.last_seen)) / 864e5 > 7;
  const snip = x => `<button type="button" class="sc-copy" data-act="copy-snippet" data-text="${esc(snippetFor(x.id))}">Copy snippet</button>`;

  if (table) {
    const th = (k, label, cls = '') => `<th class="${cls}" aria-sort="${sort === k ? (ovFlip === (k !== 'name') ? 'ascending' : 'descending') : 'none'}"><button type="button" data-ok="${k}">${label}${sort === k ? (ovFlip === (k !== 'name') ? ' ▲' : ' ▼') : ''}</button></th>`;
    grid.innerHTML = `<div class="card" style="padding:4px 16px"><div class="scroll"><table class="ovtable"><thead><tr>${th('name', 'Site')}${th('views', 'Views', 'num')}${th('change', 'Change')}<th class="num">Visitors</th><th>Online</th>${th('recent', 'Last visit')}<th>Trend</th></tr></thead><tbody>${
      list.map(x => {
        const never = !x.last_seen;
        return `<tr class="ovrow" role="link" tabindex="0" data-id="${esc(x.id)}">
          <td><b title="${esc(x.name)}">${esc(x.name)}</b><small title="${esc(x.domain)}">${esc(x.domain)}</small></td>
          <td class="num"><b>${x.totals.views}</b>${never ? '' : `<div class="share" title="${shareT(x)}% of all page views"><i style="width:${Math.max(share(x), x.totals.views ? 2 : 0)}%"></i></div>`}</td>
          <td>${ovPill(x)}</td>
          <td class="num">${never ? '' : x.totals.visitors}</td>
          <td>${x.live ? `<span class="live">● ${x.live}</span>` : ''}</td>
          <td>${never ? `No visits yet ${snip(x)}` : `<span${stale(x) ? ' style="color:#b45309"' : ''}>${agoEl(x.last_seen)}</span>`}</td>
          <td>${never || stale(x) || !x.totals.views ? '' : sparkOf(x, 'mini')}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    return;
  }

  grid.innerHTML = list.map(x => {
    const never = !x.last_seen, st = stale(x);
    const spark = never || st || !x.totals.views ? '' : sparkOf(x);
    const acts = [x.downloads && `${x.downloads} download${x.downloads === 1 ? '' : 's'}`, x.contacts && `${x.contacts} contact click${x.contacts === 1 ? '' : 's'}`].filter(Boolean);
    const extra = [x.top_page && `Top page ${x.top_page}`, x.top_source && `from ${x.top_source}`, ...acts].filter(Boolean).join(' · ');
    const row = never ? 'No visits yet.' : `${x.totals.visitors} visitor${x.totals.visitors === 1 ? '' : 's'} · ${x.totals.named} named · ${shareT(x)}% of views`;
    return `<div class="sitecard${never ? ' idle' : ''}" role="button" tabindex="0" data-id="${esc(x.id)}">
      <div class="sc-head"><b title="${esc(x.name)}">${esc(x.name)}</b>${x.live ? `<span class="sc-live">● ${x.live} online</span>` : ''}</div>
      <div class="sc-dom" title="${esc(x.domain)}">${esc(x.domain)}</div>
      <div class="sc-numrow"><div class="sc-num">${x.totals.views} <span>views</span></div>${ovPill(x)}</div>
      <div class="sc-row">${row}</div>
      ${extra ? `<div class="sc-extra" title="${esc(extra)}">${esc(extra)}</div>` : ''}
      <div class="sc-bottom">${spark}<div class="sc-foot${st ? ' stale' : ''}">${never ? '' : `Last visit ${agoEl(x.last_seen)}`}</div>${never ? snip(x) : ''}</div>
    </div>`;
  }).join('');
}
$('stCronX').onclick = () => { $('stCron').hidden = true; try { sessionStorage.setItem('tk_cron_x', '1'); } catch (e) {} };
$('ovInfo').onclick = () => { const open = $('ovNote').hidden; $('ovNote').hidden = !open; $('ovInfo').setAttribute('aria-expanded', open); };
$('ovSort').value = lsRead('tk_ovsort') || 'views';
const saveSort = () => { try { localStorage.setItem('tk_ovsort', $('ovSort').value); } catch (e) {} };
$('ovSort').onchange = () => { ovFlip = false; saveSort(); renderCards(); };
$('ovCards').onclick = () => { try { localStorage.setItem('tk_ovview', 'cards'); } catch (e) {} renderCards(); };
$('ovList').onclick = () => { try { localStorage.setItem('tk_ovview', 'list'); } catch (e) {} renderCards(); };

function renderOvTop(d) {
  const siteName = Object.fromEntries(d.sites.map(x => [x.id, x.name]));
  const tiles = [];
  const dl = d.sites.filter(x => x.downloads).sort((p, q) => q.downloads - p.downloads)[0];
  if (dl) tiles.push(`<button type="button" class="tile" data-go="${esc(dl.id)}"><small>Most downloaded</small><b title="${esc(dl.name)}">${esc(dl.name)}</b><small>${dl.downloads} download${dl.downloads === 1 ? '' : 's'}</small></button>`);
  if (d.top_campaign) tiles.push(`<div class="tile"><small>Top campaign</small><b title="${esc(d.top_campaign.label)}">${esc(d.top_campaign.label)}</b><small>${d.top_campaign.n} visitor${d.top_campaign.n === 1 ? '' : 's'}</small></div>`);
  $('ovHigh').innerHTML = tiles.join('');
  $('ovHigh').hidden = !tiles.length;
  $('ovHigh').classList.toggle('two', tiles.length === 2);
  $('ovTop').classList.toggle('two', tiles.length > 0);
  const rows = ovAllRecent ? d.recent : d.recent.slice(0, 5);
  $('ovRecent').innerHTML = d.recent.length
    ? rows.map(r => `<div class="rnrow"><button class="ovname" data-site="${esc(r.site_id)}" data-name="${esc(r.name)}">${esc(r.name)}</button><span class="rn-meta">${esc(siteName[r.site_id] || r.site_id)} · ${r.visits} visit${r.visits === 1 ? '' : 's'} · ${esc(place(r))}</span><span class="rn-when">${agoEl(r.last_seen)}</span></div>`).join('')
      + (rows.length < d.recent.length ? `<button type="button" class="showmore" id="ovMoreRecent">Show all ${d.recent.length}</button>` : '')
    : '<div class="empty">Nobody named in this range. Send someone a link like <code>?ref=Sara-Acme</code>.</div>';
}

async function loadOverview(seq) {
  const d = await api(`/api/overview?days=${days}`);
  if (seq !== loadSeq) return;
  const sum = (k, f = 'totals') => d.sites.reduce((a, x) => a + x[f][k], 0);
  const vs = d.days === 1 ? 'previous 24 hours' : `previous ${d.days} days`;
  $('oViews').textContent = sum('views');
  $('oVisitors').textContent = sum('visitors');
  $('oNamed').textContent = sum('named');
  const liveAll = d.sites.reduce((a, x) => a + x.live, 0);
  $('oLive').textContent = liveAll;
  $('dOViews').innerHTML = delta(sum('views'), sum('views', 'prev'), vs);
  $('dOVisitors').innerHTML = delta(sum('visitors'), sum('visitors', 'prev'), vs);
  $('dONamed').innerHTML = delta(sum('named'), sum('named', 'prev'), vs);

  ovData = d; ovVs = vs;
  paintBackup(d.sites.length);
  api('/api/settings').then(c => {
    if (seq !== loadSeq) return;
    paintBackup(d.sites.length, c.sites.reduce((a, x) => a + Number(x.total || 0), 0));
    if (!lsRead('tk_cron_x') && !sessionStorage.getItem('tk_cron_x')) $('stCron').hidden = c.cronConfigured;
  }).catch(() => {});
  renderBioCard();
  renderOvTop(d);
  renderCards();
}
$('overview').addEventListener('click', e => {
  const n = e.target.closest('.ovname');
  if (n) return goSite(n.dataset.site, n.dataset.name);
  if (e.target.closest('#ovMoreRecent')) { ovAllRecent = true; return renderOvTop(ovData); }
  const t = e.target.closest('[data-go]');
  if (t) return goSite(t.dataset.go);
  const h = e.target.closest('[data-ok]');
  if (h) {
    const k = h.dataset.ok;
    ovFlip = $('ovSort').value === k ? !ovFlip : false;
    $('ovSort').value = k; saveSort(); return renderCards();
  }
  if (e.target.closest('.sc-copy')) return;
  const c = e.target.closest('.sitecard, .ovrow');
  if (c) goSite(c.dataset.id);
});
$('overview').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.sitecard, .ovrow')) { e.preventDefault(); goSite(e.target.dataset.id); }
});

// ---- Named visitors: search + sort, and recent activity: filters. All client-side on the loaded data.
let lastData = null;
const nm = { q: '', key: 'last_seen', dir: -1 };
const rc = { who: 'all', event: 'all', country: 'all' };
const LIMIT = 10, more = { named: false, recent: false };
const moreBtn = (k, n) => `<button type="button" class="showmore" data-more="${k}">Show all ${n}</button>`;
const SORTABLE = [['name', 'Name'], ['visits', 'Visits'], ['actions', 'Actions'], ['last_seen', 'Last seen']];

function renderNamed() {
  const all = lastData.named;
  if (!all.length) {
    $('named').innerHTML = '<div class="empty"><p>Nobody has been named yet. Send someone a link with their name in it, like <code>?ref=Sara-Acme</code>, and their visits show up here.</p><button data-act="make-link">Create a visitor link</button></div>';
    $('nmCount').textContent = '';
    $('nmSearch').hidden = true; $('nmSort').hidden = true;
    return;
  }
  const q = nm.q.trim().toLowerCase();
  const rows = all.filter(n => !q || n.name.toLowerCase().includes(q));
  rows.sort((a, b) => nm.dir * (nm.key === 'name' ? a.name.localeCompare(b.name)
    : nm.key === 'last_seen' ? new Date(a.last_seen) - new Date(b.last_seen) : a[nm.key] - b[nm.key]));
  $('nmSearch').hidden = all.length <= 8 && !nm.q;
  $('nmSort').hidden = false;
  $('nmCount').textContent = rows.length === all.length ? `${all.length} total` : `${rows.length} of ${all.length}`;
  $('nmSort').value = nm.key;
  if (!rows.length) { $('named').innerHTML = `<div class="empty">No names match “${esc(nm.q.trim())}”.</div>`; return; }
  const th = SORTABLE.map(([k, label]) => `<th aria-sort="${nm.key === k ? (nm.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button class="sortbtn${nm.key === k ? ' on' : ''}" data-k="${k}"${k === 'actions' ? ' title="Custom events such as clicks, not page views"' : ''}>${label}${nm.key === k ? (nm.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`);
  const shown = more.named ? rows : rows.slice(0, LIMIT);
  $('named').innerHTML = `<table class="rt rt-named"><thead><tr>${th.slice(0, 1).join('')}${th.slice(1).join('')}<th>Location</th><th>Device</th></tr></thead><tbody>${
    shown.map(n => `<tr><td class="pri"><button class="namebtn" data-name="${esc(n.name)}">${esc(n.name)}</button></td><td data-label="Visits">${n.visits}<span class="u"> visit${n.visits === 1 ? '' : 's'}</span></td><td data-label="Actions">${n.actions}<span class="u"> action${n.actions === 1 ? '' : 's'}</span></td><td data-label="Last seen">${agoEl(n.last_seen)}</td><td data-label="Location">${esc(place(n))}</td><td data-label="Device">${esc(n.device)}</td></tr>`).join('')}</tbody></table>${shown.length < rows.length ? moreBtn('named', rows.length) : ''}`;
}

function setSort(key, dir) {
  nm.dir = dir ?? (nm.key === key ? -nm.dir : (key === 'name' ? 1 : -1));
  nm.key = key;
  renderNamed();
}
document.addEventListener('click', e => {
  const b = e.target.closest('.showmore');
  if (!b) return;
  more[b.dataset.more] = true;
  b.dataset.more === 'named' ? renderNamed() : renderRecent();
});
$('named').addEventListener('click', e => { const b = e.target.closest('.sortbtn'); if (b) setSort(b.dataset.k); });
$('nmSort').onchange = e => setSort(e.target.value, e.target.value === 'name' ? 1 : -1);
$('nmSearch').oninput = e => { nm.q = e.target.value; syncUrl(); if (lastData) renderNamed(); };

// On a phone the six breakdown cards become tabs; on desktop they all show.
function showBreakdown(k) {
  document.querySelectorAll('#bkTabs button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  document.querySelectorAll('#bkGrid > .card').forEach(c => c.classList.toggle('on', (c.querySelector('[id]')?.id === k) || c.id === k));
}
$('bkTabs').onclick = e => { const b = e.target.closest('button[data-k]'); if (b) showBreakdown(b.dataset.k); };
showBreakdown('paths');

// Keep the chosen option when the list is rebuilt on refresh; fall back to "all" if it vanished.
function setOptions(sel, key, first, values, label) {
  const cur = rc[key];
  sel.innerHTML = `<option value="all">${first}</option>` + values.map(v => `<option value="${esc(v)}">${esc(label(v))}</option>`).join('');
  if (!values.includes(cur)) rc[key] = 'all';
  sel.value = rc[key];
}
function fillRecentFilters() {
  const ev = [...new Set(lastData.recent.map(r => r.event))].sort((a, b) => (a === 'pageview' ? -1 : b === 'pageview' ? 1 : a.localeCompare(b)));
  const co = [...new Set(lastData.recent.map(r => r.country).filter(Boolean))].sort();
  setOptions($('rcEvent'), 'event', 'All events', ev, v => (v === 'pageview' ? 'Page views' : evLabel(v)));
  setOptions($('rcCountry'), 'country', 'All countries', co, countryLabel);
}
function renderRecent() {
  const all = lastData.recent;
  if (!all.length) { $('recent').innerHTML = '<div class="empty"><p>No activity yet. Once the snippet is on your site, visits show up here within a few seconds.</p><button data-act="show-install">Show the install snippet</button></div>'; $('rcCount').textContent = ''; return; }
  const rows = all.filter(r => (rc.who === 'all' || (rc.who === 'named') === !!r.name)
    && (rc.event === 'all' || r.event === rc.event) && (rc.country === 'all' || r.country === rc.country));
  $('rcCount').textContent = rows.length === all.length ? `${all.length} event${all.length === 1 ? '' : 's'}` : `${rows.length} of ${all.length}`;
  if (!rows.length) { $('recent').innerHTML = '<div class="empty">Nothing matches these filters.</div>'; return; }
  const shown = more.recent ? rows : rows.slice(0, LIMIT);
  $('recent').innerHTML = `<table class="rt rt-recent"><thead><tr><th>When</th><th>Who</th><th>Event</th><th>Page</th><th>Location</th><th>From</th></tr></thead><tbody>${
    shown.map(r => `<tr><td data-label="When">${agoEl(r.ts)}</td><td class="pri">${r.name ? `<button class="namebtn" data-name="${esc(r.name)}">${esc(r.name)}</button>` : 'Anonymous'}</td><td data-label="Event">${esc(evLabel(r.event))}</td><td data-label="Page">${esc(pageLabel(r.path))}</td><td data-label="Location">${esc(place(r))}</td><td data-label="From"${r.referrer ? '' : ' class="direct"'}>${esc(r.referrer || 'Direct')}</td></tr>`).join('')}</tbody></table>${shown.length < rows.length ? moreBtn('recent', rows.length) : ''}`;
}
$('rcWho').onclick = e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  rc.who = b.dataset.v;
  document.querySelectorAll('#rcWho button').forEach(x => x.classList.toggle('on', x === b));
  syncUrl();
  renderRecent();
};
$('rcEvent').onchange = e => { rc.event = e.target.value; syncUrl(); renderRecent(); };
$('rcCountry').onchange = e => { rc.country = e.target.value; syncUrl(); renderRecent(); };

function resetFilters() {
  nm.q = ''; $('nmSearch').value = '';
  rc.who = 'all'; rc.event = 'all'; rc.country = 'all'; more.named = more.recent = false;
  document.querySelectorAll('#rcWho button').forEach(x => x.classList.toggle('on', x.dataset.v === 'all'));
}

function delta(cur, prev, vs) {
  if (!cur && !prev) return '';
  if (!prev) return `<span class="up">new</span> · vs ${vs}`;
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return `no change vs ${vs}`;
  return `<span class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}%</span> vs ${vs}`;
}

function bucketLabel(t, hourly, long) {
  return hourly
    ? new Date(t).toLocaleString(undefined, long ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
    : new Date(t).toLocaleDateString(undefined, { timeZone: 'UTC', ...(long ? { weekday: 'short' } : {}), day: 'numeric', month: 'short' });
}

let chartRows = [], chartHourly = false;

// Zero-filled buckets, so quiet days show as gaps instead of disappearing.
function fillBuckets(daily, nDays) {
  const hourly = nDays <= 1;
  const unit = hourly ? 3600e3 : 864e5;
  const n = hourly ? 25 : nDays + 1;
  const end = Math.floor(Date.now() / unit) * unit;
  const map = new Map(daily.map(x => [new Date(x.bucket).getTime(), x]));
  const rows = Array.from({ length: n }, (_, i) => {
    const t = end - (n - 1 - i) * unit;
    const x = map.get(t);
    return { t, views: x?.views ?? 0, visitors: x?.visitors ?? 0 };
  });
  return { hourly, rows };
}

function renderChart(d) {
  const { hourly, rows } = fillBuckets(d.daily, d.days);
  const n = rows.length;
  if (!d.totals.views) { $('chart').innerHTML = '<div class="empty">No visits in this range. Try a longer one.</div>'; $('chart').setAttribute('aria-label', 'No visits in this range'); $('chartTable').tBodies[0].innerHTML = ''; $('xaxis').innerHTML = ''; return; }
  const max = Math.max(1, ...rows.map(r => r.views));
  $('chart').innerHTML = rows.map((r, i) =>
    `<div class="col" data-i="${i}"><div class="b" style="height:${(r.views / max) * 100}%"><div class="u" style="height:${r.views ? (r.visitors / r.views) * 100 : 0}%"></div></div></div>`).join('');
  $('xaxis').innerHTML = [...new Set([0, 0.25, 0.5, 0.75, 1].map(f => Math.round((n - 1) * f)))].map(i => `<span>${esc(bucketLabel(rows[i].t, hourly))}</span>`).join('');
  const peak = rows.reduce((a, r) => (r.views > a.views ? r : a), rows[0]);
  $('chart').setAttribute('aria-label', `Traffic chart: ${d.totals.views} page views and ${d.totals.visitors} unique visitors. Busiest ${hourly ? 'hour' : 'day'}: ${bucketLabel(peak.t, hourly, true)} with ${peak.views} views.`);
  $('chartTable').tBodies[0].innerHTML = rows.map(r => `<tr><td>${esc(bucketLabel(r.t, hourly, true))}</td><td>${r.views}</td><td>${r.visitors}</td></tr>`).join('');
  $('ymax').innerHTML = `<b>${max}</b>`;
  $('ymid').innerHTML = max >= 4 ? `<b>${Math.round(max / 2)}</b>` : '';
  chartRows = rows; chartHourly = hourly;
}

const tip = $('tip');
function showTip(col) {
  const r = chartRows[Number(col.dataset.i)];
  if (!r) return;
  tip.innerHTML = `<b>${esc(bucketLabel(r.t, chartHourly, true))}</b><br>${r.views} view${r.views === 1 ? '' : 's'} · ${r.visitors} visitor${r.visitors === 1 ? '' : 's'}`;
  tip.hidden = false;
  const w = col.closest('.chartwrap').getBoundingClientRect(), c = col.getBoundingClientRect();
  tip.style.left = Math.min(Math.max(c.left - w.left + c.width / 2, 70), w.width - 70) + 'px';
  tip.style.top = '-6px';
}
$('chart').addEventListener('mouseover', e => { const c = e.target.closest('.col'); if (c) showTip(c); });
$('chart').addEventListener('click', e => { const c = e.target.closest('.col'); if (c) showTip(c); });
$('chart').addEventListener('mouseleave', () => { tip.hidden = true; });
// Touch: drag a finger across the chart to read each bar.
const colFromX = x => {
  const n = $('chart').querySelectorAll('.col').length, r = $('chart').getBoundingClientRect();
  return n ? Math.max(0, Math.min(n - 1, Math.floor(((x - r.left) / r.width) * n))) : -1;
};
['pointerdown', 'pointermove'].forEach(t => $('chart').addEventListener(t, e => {
  if (e.pointerType !== 'touch' || (t === 'pointermove' && !(e.buttons & 1))) return;
  const i = colFromX(e.clientX);
  if (i >= 0 && i !== chartPos) stepChart(i);
}));
// Keyboard: focus the chart, then arrow keys step through the bars (Home/End jump, Escape hides the tooltip).
let chartPos = -1;
function stepChart(i) {
  const cols = $('chart').querySelectorAll('.col');
  if (!cols.length) return;
  chartPos = Math.max(0, Math.min(cols.length - 1, i));
  cols.forEach((c, k) => c.classList.toggle('on', k === chartPos));
  showTip(cols[chartPos]);
}
$('chart').addEventListener('keydown', e => {
  const n = $('chart').querySelectorAll('.col').length;
  const keys = { ArrowLeft: chartPos - 1, ArrowRight: chartPos + 1, Home: 0, End: n - 1 };
  if (e.key in keys) { e.preventDefault(); stepChart(chartPos < 0 && e.key === 'ArrowLeft' ? n - 1 : keys[e.key]); }
  else if (e.key === 'Escape') { tip.hidden = true; }
});
$('chart').addEventListener('blur', () => { tip.hidden = true; chartPos = -1; $('chart').querySelectorAll('.col.on').forEach(c => c.classList.remove('on')); });

// Spaces become hyphens so the link stays readable; t.js turns them back into spaces.
function visitorLink() {
  const site = sites.find(x => x.id === $('site').value);
  const name = $('lkName').value.trim().replace(/\s+/g, '-');
  const src = $('lkSource').value.trim(), camp = $('lkCampaign').value.trim();
  if (!site || !(name || src || camp)) return '';
  let path = $('lkPath').value.trim() || '/';
  if (!path.startsWith('/')) path = '/' + path;
  const q = [];
  if (name) q.push('ref=' + encodeURIComponent(name));
  if (src) q.push('utm_source=' + encodeURIComponent(src.replace(/\s+/g, '-')));
  if (camp) q.push('utm_campaign=' + encodeURIComponent(camp.replace(/\s+/g, '-')));
  return `https://${site.domain}${path}${path.includes('?') ? '&' : '?'}${q.join('&')}`;
}

function updateLink() {
  const link = visitorLink();
  $('lkOut').textContent = link || 'Type a name, or where you will share it';
  $('lkOut').classList.toggle('dim', !link);
  $('lkCopy').disabled = !link;
}

$('lkName').oninput = updateLink;
$('lkPath').oninput = updateLink;
$('lkSource').oninput = updateLink;
$('lkCampaign').oninput = updateLink;
$('lkCopy').onclick = async () => {
  const link = visitorLink();
  if (!link) return;
  try { await navigator.clipboard.writeText(link); }
  catch {
    const r = document.createRange(); r.selectNodeContents($('lkOut'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy');
  }
  $('lkCopy').textContent = 'Copied';
  setTimeout(() => { $('lkCopy').textContent = 'Copy'; }, 1500);
};

// Events arrive newest first. A new session starts after 30 minutes of silence.
function groupSessions(events) {
  const asc = [...events].reverse();
  const out = [];
  for (const e of asc) {
    const last = out[out.length - 1];
    if (last && new Date(e.ts) - new Date(last.events[last.events.length - 1].ts) < 30 * 60000) last.events.push(e);
    else out.push({ events: [e] });
  }
  return out.reverse();
}

function renderVisitor(d) {
  const last = d.events[0];
  const loc = place(last);
  const sessions = groupSessions(d.events);
  $('vbody').innerHTML = `
    <div class="vtools"><button type="button" id="vLink">Copy their link</button><span id="vLinkMsg" role="status"></span></div>
    <div class="chips">
      <div class="chip"><b>${d.visits}</b><span>Page views</span></div>
      <div class="chip"><b>${d.actions}</b><span>Actions</span></div>
      <div class="chip"><b>${esc(fmtDayOnly(d.first_seen))}</b><span>First seen · ${esc(fmtTime(d.first_seen))}</span></div>
      <div class="chip"><b>${esc(fmtDayOnly(d.last_seen))}</b><span>Last seen · ${esc(fmtTime(d.last_seen))}</span></div>
      <div class="chip"><b>${esc(loc)}</b><span>Last location</span></div>
      <div class="chip"><b>${d.devices}</b><span>${d.devices === 1 ? 'Device' : 'Devices'} · ${esc(last.device)} / ${esc(last.browser)}</span></div>
      ${d.campaign ? `<div class="chip"><b>${esc(d.campaign)}</b><span>Campaign</span></div>` : ''}
    </div>
    ${(() => {
      const hits = d.events.filter(e => e.event.startsWith('downloaded-') || e.event === 'clicked-email' || e.event === 'clicked-phone');
      if (!hits.length) return '';
      const c = {}; hits.forEach(e => { const k = evLabel(e.event); c[k] = (c[k] || 0) + 1; });
      return `<p class="vacts"><b>Took action:</b> ${Object.entries(c).map(([k, n]) => esc(k) + (n > 1 ? ` ×${n}` : '')).join(' · ')}</p>`;
    })()}
    ${sessions.map(s => {
      const first = s.events[0], end = s.events[s.events.length - 1];
      return `<div class="session"><h3>${esc(fmtDate(first.ts))}, ${esc(fmtTime(first.ts))} · ${s.events.length} event${s.events.length === 1 ? '' : 's'} · ${dur(new Date(end.ts) - new Date(first.ts))}${first.referrer ? ' · from ' + esc(first.referrer) : ''}</h3>
      <ul class="tl">${s.events.map(e => e.event === 'pageview'
        ? `<li><span class="t">${esc(fmtTime(e.ts))}</span>Viewed <b>${esc(pageLabel(e.path))}</b></li>`
        : `<li class="act"><span class="t">${esc(fmtTime(e.ts))}</span>${esc(evLabel(e.event))}${e.path ? `<span class="m">on ${esc(pageLabel(e.path))}</span>` : ''}</li>`).join('')}</ul></div>`;
    }).join('')}
    ${d.events.length >= 300 ? '<div class="empty">Showing the latest 300 events.</div>' : ''}`;
}

document.addEventListener('click', async e => {
  if (!e.target.closest('#vLink')) return;
  const site = sites.find(x => x.id === $('site').value);
  if (!site) return;
  await copyText(`https://${site.domain}/?ref=${encodeURIComponent($('vname').textContent.trim().replace(/\s+/g, '-'))}`);
  $('vLinkMsg').textContent = 'Copied';
  setTimeout(() => { $('vLinkMsg').textContent = ''; }, 1500);
});

async function openVisitor(name) {
  lastFocus = document.activeElement;
  $('vname').textContent = name;
  $('vbody').innerHTML = '<div class="empty">Loading…</div>';
  $('overlay').hidden = false; $('vpanel').hidden = false;
  document.body.classList.add('modal-open');
  history.pushState({ vp: 1 }, '', '#s=' + $('site').value + '&v=' + encodeURIComponent(name));
  $('vclose').focus();
  try { renderVisitor(await api(`/api/visitor?site=${$('site').value}&name=${encodeURIComponent(name)}`)); }
  catch (e) { $('vbody').innerHTML = `<div class="empty">${esc(e.message === 'not found' ? 'No events for this visitor.' : 'Could not load this visitor.')}</div>`; }
}

// The panel has its own history entry, so Back (or the Android back button) closes it instead of leaving the app.
function hideVisitor(fromHistory) {
  $('overlay').hidden = true; $('vpanel').hidden = true;
  document.body.classList.remove('modal-open');
  if (!fromHistory) history.replaceState(null, '', location.pathname + location.search);
  lastFocus?.focus?.();
}
function closeVisitor() {
  if (history.state?.vp) history.back(); else hideVisitor();
}

// Back/forward: close the panel, or re-read the site, range and settings view from the URL.
function applyUrl() {
  initFromUrl();
  const want = wantSite === 'all' ? ALL : wantSite;
  wantSite = null;
  if (want && [...$('site').options].some(o => o.value === want)) $('site').value = want;
  if (!$('site').value || $('site').value === ALL) settingsOpen = false;
  stDirty = false;
  paintSidebar(); updateLink();
}
addEventListener('popstate', () => {
  if ($('app').hidden) return;
  const vp = Boolean(history.state?.vp);
  if (!$('vpanel').hidden && !vp) return hideVisitor(true);
  if (vp) return;
  applyUrl(); load();
});

document.addEventListener('click', e => {
  const b = e.target.closest('.namebtn');
  if (b) openVisitor(b.dataset.name);
});
$('vclose').onclick = closeVisitor;
$('overlay').onclick = closeVisitor;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('vpanel').hidden) closeVisitor(); });

// Pull down from the top of the page to refresh (phones).
let ptr = null;
const paintPtr = (d, done) => {
  const el = $('ptr');
  el.style.transition = done ? 'transform .2s, opacity .2s' : 'none';
  el.style.transform = d ? `translateY(${Math.min(d, 90) - 10}px)` : 'translateY(-100%)';
  el.style.opacity = d ? Math.min(1, d / 60) : 0;
  el.innerHTML = d ? `<span>${d >= 70 ? '↑ Release to refresh' : '↓ Pull to refresh'}</span>` : '';
};
document.addEventListener('touchstart', e => {
  const blocked = !matchMedia('(max-width: 640px)').matches || scrollY > 0 || $('app').hidden || !$('vpanel').hidden || document.querySelector('dialog[open]') || !$('menu').hidden;
  ptr = blocked ? null : { y: e.touches[0].clientY, d: 0 };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!ptr) return;
  const d = e.touches[0].clientY - ptr.y;
  ptr.d = scrollY > 0 ? 0 : Math.max(0, d);
  paintPtr(ptr.d);
}, { passive: true });
document.addEventListener('touchend', () => {
  if (!ptr) return;
  const go = ptr.d >= 70; ptr = null; paintPtr(0, true);
  if (go) { refreshSites(); load({ soft: true }); }
});

// Keyboard shortcuts: r refresh, / search names, 1-4 range. Ignored while typing or when a dialog is open.
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('dialog[open]') || !$('vpanel').hidden) return;
  if (e.key === 'r') { $('refreshBtn').click(); }
  else if (e.key === '/' && $('nmSearch') && $('nmSearch').offsetParent) { e.preventDefault(); $('nmSearch').focus(); }
  else if (e.key === '?') { $('kbDlg').showModal(); }
  else if ('1234'.includes(e.key) && e.key) { const b = document.querySelectorAll('#range button')[Number(e.key) - 1]; if (b) b.click(); }
});

// Deep link: #v=Name opens that visitor once the dashboard has loaded.
// #s=<site>&v=<name> (or the older #v=<name>, which uses the selected site).
function hashTarget() {
  const m = location.hash.match(/^#(?:s=([^&]+)&)?v=(.+)$/);
  return m ? { site: m[1] ? decodeURIComponent(m[1]) : null, name: decodeURIComponent(m[2]) } : null;
}
function openFromHash() {
  const h = hashTarget();
  const cur = $('site').value;
  if (h && cur && cur !== ALL && (!h.site || h.site === cur)) openVisitor(h.name);
}

initFromUrl();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---- Fingerprint / Face ID (passkeys). The password still works; this is a faster way in on a device you trust.
const hasBio = Boolean(window.PublicKeyCredential && navigator.credentials);
let bioReady = false, bioAuto = true;
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
const fromB64 = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function bioPost(action, body, signedIn) {
  const r = await fetch('/api/passkey?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signedIn ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; e.wait = Number(r.headers.get('Retry-After') || 0); throw e; }
  return j;
}
function deviceName() {
  const u = navigator.userAgent;
  const dev = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android phone' : /Windows/.test(u) ? 'Windows PC' : /Mac/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux PC' : 'This device';
  return dev + ' · ' + (/Edg\//.test(u) ? 'Edge' : /Firefox/.test(u) ? 'Firefox' : /Chrome|CriOS/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : 'browser');
}

async function enableBio() {
  const opts = await bioPost('reg-options', {}, true);
  opts.challenge = fromB64(opts.challenge); opts.user.id = fromB64(opts.user.id);
  (opts.excludeCredentials || []).forEach(c => { c.id = fromB64(c.id); });
  const cred = await navigator.credentials.create({ publicKey: opts });
  const response = {
    id: cred.id, rawId: toB64(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    response: { clientDataJSON: toB64(cred.response.clientDataJSON), attestationObject: toB64(cred.response.attestationObject), transports: cred.response.getTransports ? cred.response.getTransports() : [] },
  };
  const out = await bioPost('reg-verify', { response, label: deviceName() }, true);
  lsSet('tk_pk', out.id); lsSet('tk_pk_no', null);
}

async function signInWithBio() {
  clearLogin();
  $('bioBtn').disabled = true;
  try {
    const opts = await bioPost('auth-options', {});
    opts.challenge = fromB64(opts.challenge);
    const cred = await navigator.credentials.get({ publicKey: opts });
    const a = cred.response;
    const out = await bioPost('auth-verify', { response: {
      id: cred.id, rawId: toB64(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      response: { clientDataJSON: toB64(a.clientDataJSON), authenticatorData: toB64(a.authenticatorData), signature: toB64(a.signature), userHandle: a.userHandle ? toB64(a.userHandle) : undefined },
    } });
    token = out.token;
    sites = await api('/api/sites'); sessionStorage.setItem('tk_admin', token); await opening(); start();
  } catch (err) {
    let m = '';
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') m = '';
    else if (err.status === 404) { lsSet('tk_pk', null); paintBio(); m = "This device isn't set up for fingerprint unlock any more. Use your password."; }
    else if (err.status === 429) m = `Too many tries. Try again in ${Math.max(Math.ceil(err.wait / 60), 1)} minute(s).`;
    else if (err.status === 401) m = "Fingerprint wasn't accepted. Use your password.";
    else if (!(err instanceof TypeError)) m = `Fingerprint sign-in failed (${err.message}). Use your password.`;
    else m = "Can't reach the server. Check your connection.";
    if (m) loginError(m);
    focusPw();
  } finally { $('bioBtn').disabled = false; }
}

// Show the unlock button only on a device that has been set up, and offer it once automatically.
function paintBio() {
  const show = hasBio && bioReady && Boolean(lsGet('tk_pk'));
  $('bioWrap').hidden = !show;
  if (show && bioAuto && !$('login').hidden) { bioAuto = false; signInWithBio(); }
}
$('bioBtn').onclick = signInWithBio;
if (hasBio && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(v => { bioReady = v; paintBio(); }).catch(() => {});
}

function offerBio() {
  $('bioPrompt').hidden = !(hasBio && bioReady && !lsGet('tk_pk') && !lsGet('tk_pk_no'));
}
$('bioNo').onclick = () => { lsSet('tk_pk_no', '1'); $('bioPrompt').hidden = true; };
$('bioYes').onclick = async () => {
  $('bioYes').disabled = true;
  try { await enableBio(); $('bioPrompt').hidden = true; }
  catch (err) { if (err.name !== 'NotAllowedError') showBanner(`Couldn't turn on fingerprint unlock (${err.message}).`); }
  finally { $('bioYes').disabled = false; }
};

async function renderBioCard() {
  $('bioCard').hidden = !hasBio;
  if (!hasBio) return;
  let list = [];
  try { list = await api('/api/passkey'); } catch (e) { if (e.message === 'unauthorized') return; }
  const mine = lsGet('tk_pk');
  const when = t => t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never';
  const icon = l => (/iphone|android|pixel|galaxy|phone|ipad|tablet|mobile/i.test(l || '') ? '📱' : '💻');
  const FP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>';
  const BIN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"/></svg>';
  $('bioBody').innerHTML = (list.length ? list.map(d => `<div class="biorow"><span class="bio-ic" aria-hidden="true">${icon(d.label)}</span><span class="bio-txt"><b>${esc(d.label || 'Device')}</b>${d.id === mine ? '<span class="badge">This device</span>' : ''}<small>Added ${esc(when(d.created_at))} · last used ${esc(when(d.last_used))}</small></span><button type="button" class="rm" data-bio-del="${esc(d.id)}" data-label="${esc(d.label || 'this device')}" aria-label="Remove ${esc(d.label || 'device')}">${BIN}<span>Remove</span></button></div>`).join('')
    : '<p style="margin-top:0">No devices yet.</p>')
    + (bioReady && !(mine && list.some(d => d.id === mine)) ? `<p style="margin:12px 0 0"><button type="button" id="bioAdd" class="primary iconbtn">${FP}<span>Turn on for this device</span></button></p>` : '')
    + '<p class="hint" style="margin:10px 0 0">Your password always works too. Removing a device here stops its fingerprint unlock.</p>';
}
document.addEventListener('click', async e => {
  const del = e.target.closest('[data-bio-del]');
  const add = e.target.closest('#bioAdd');
  if (!del && !add) return;
  const btn = del || add;
  $('bioMsg').hidden = true;
  if (del && !(await confirmDialog({ title: `Remove ${del.dataset.label}?`, message: 'It will no longer sign in with fingerprint or Face ID. Your password still works, and you can turn it on again later.', confirmText: 'Remove', danger: true }))) return;
  btn.disabled = true;
  try {
    if (del) { await api('/api/passkey?id=' + encodeURIComponent(del.dataset.bioDel), { method: 'DELETE' }); if (del.dataset.bioDel === lsGet('tk_pk')) lsSet('tk_pk', null); }
    else await enableBio();
    await renderBioCard();
  } catch (err) { btn.disabled = false; if (err.name !== 'NotAllowedError' && err.message !== 'unauthorized') { $('bioMsg').textContent = del ? `Could not remove the device (${err.message || 'try again'}).` : (err.message || 'Something went wrong.'); $('bioMsg').hidden = false; } }
});
const showLogin = () => { $('login').hidden = false; focusPw(); paintBio(); };
if (token) api('/api/sites').then(start).catch(showLogin);
else showLogin();
