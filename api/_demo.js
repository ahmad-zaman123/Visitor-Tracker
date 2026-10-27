// Sample data for the read-only demo session. Nothing here touches the database.
// Series are seeded, so the same site and range always look the same within a day.

const DAY = 864e5, HOUR = 36e5;

function rng(seed) {
  let a = [...String(seed)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0), 1) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_SITES = [
  { id: 'demo-portfolio', name: 'Portfolio', domain: 'jordan-lee.example', base: 38, live: 2 },
  { id: 'demo-notes', name: 'Notes App', domain: 'notes-app.example', base: 17, live: 1 },
  { id: 'demo-cafe', name: 'Corner Café', domain: 'corner-cafe.example', base: 6, live: 0 },
];

const NAMED = [
  { name: 'Sara Acme', country: 'GB', city: 'London', device: 'Desktop', browser: 'Chrome', site: 'demo-portfolio', visits: 5, actions: 3, ago: 22 },
  { name: 'Omar Recruiter', country: 'AE', city: 'Dubai', device: 'Desktop', browser: 'Safari', site: 'demo-portfolio', visits: 9, actions: 4, ago: 95 },
  { name: 'Priya Hiring', country: 'IN', city: 'Bengaluru', device: 'Mobile', browser: 'Chrome', site: 'demo-portfolio', visits: 2, actions: 0, ago: 60 * 7 },
  { name: 'Tom Founder', country: 'US', city: 'Austin', device: 'Tablet', browser: 'Safari', site: 'demo-notes', visits: 3, actions: 1, ago: 60 * 26 },
  { name: 'Lena Beta', country: 'DE', city: 'Berlin', device: 'Desktop', browser: 'Firefox', site: 'demo-notes', visits: 4, actions: 2, ago: 60 * 52 },
];

const PATHS = { 'demo-portfolio': ['/', '/projects', '/about', '/#contact', '/resume'], 'demo-notes': ['/', '/pricing', '/changelog', '/docs'], 'demo-cafe': ['/', '/menu', '/hours'] };
const REFS = ['Direct', 'linkedin.com', 'github.com', 'google.com', 'news.ycombinator.com', 'x.com'];
const COUNTRIES = ['US', 'GB', 'DE', 'IN', 'PK', 'CA', 'AE', 'FR'];
const DEVICES = ['Desktop / Chrome', 'Mobile / Safari', 'Desktop / Safari', 'Mobile / Chrome', 'Desktop / Firefox', 'Tablet / Safari'];
const EVENTS = ['clicked-email', 'downloaded-resume.pdf', 'outbound-github.com', 'clicked-phone'];

const siteOf = id => DEMO_SITES.find(s => s.id === id) ?? DEMO_SITES[0];

// Rows of { bucket, views, visitors } for the last `days` (hourly for "Today").
function series(site, days, salt = '') {
  const hourly = days <= 1, unit = hourly ? HOUR : DAY, n = hourly ? 25 : days + 1;
  const end = Math.floor(Date.now() / unit) * unit, r = rng(`${site.id}|${days}|${salt}|${Math.floor(Date.now() / DAY)}`);
  return Array.from({ length: n }, (_, i) => {
    const t = end - (n - 1 - i) * unit, dow = new Date(t).getUTCDay();
    const wave = 0.7 + 0.5 * Math.sin(i / 2.6) ** 2 + r() * 0.5;
    const views = Math.round((hourly ? site.base / 12 : site.base) * wave * (dow === 0 || dow === 6 ? 0.6 : 1));
    return { bucket: new Date(t).toISOString(), views, visitors: Math.max(Math.round(views * (0.4 + r() * 0.2)), views ? 1 : 0) };
  });
}

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const totalsOf = (rows, site) => ({ views: sum(rows, 'views'), visitors: sum(rows, 'visitors'), named: NAMED.filter(x => x.site === site.id).length });

// Splits `total` across labels with a stable, top-heavy shape.
function split(labels, total, seed) {
  const r = rng(seed), w = labels.map((_, i) => (labels.length - i) ** 1.6 * (0.7 + r() * 0.6)), s = w.reduce((a, b) => a + b, 0);
  return labels.map((label, i) => ({ label, n: Math.max(Math.round((total * w[i]) / s), 1) })).filter(x => total > 0 && x.n > 0);
}

const stamp = min => new Date(Date.now() - min * 60000).toISOString();

export function demoSites() {
  return DEMO_SITES.map(s => ({ id: s.id, name: s.name, domain: s.domain, created_at: stamp(60 * 24 * 90), views_30d: sum(series(s, 30), 'views'), live: s.live }));
}

export function demoOverview(days) {
  const recent = NAMED.map(x => ({ site_id: x.site, name: x.name, last_seen: stamp(x.ago), visits: x.visits, city: x.city, country: x.country }));
  return {
    days,
    sites: DEMO_SITES.map(s => {
      const cur = series(s, days), prev = series(s, days, 'prev'), pages = PATHS[s.id];
      return {
        id: s.id, name: s.name, domain: s.domain, totals: totalsOf(cur, s), prev: totalsOf(prev, s),
        daily: cur.map(({ bucket, views }) => ({ bucket, views })),
        last_seen: stamp(s.live ? 3 : 60 * 9), live: s.live, top_page: pages[0], top_source: s.id === 'demo-cafe' ? 'google.com' : 'linkedin.com',
        downloads: s.id === 'demo-portfolio' ? 6 : 0, contacts: s.id === 'demo-portfolio' ? 3 : s.id === 'demo-cafe' ? 2 : 0,
      };
    }),
    top_campaign: { label: 'linkedin · social · job-search', n: 14 },
    recent: recent.sort((a, b) => b.last_seen.localeCompare(a.last_seen)),
  };
}

export function demoStats(siteId, days) {
  const s = siteOf(siteId), cur = series(s, days), prev = series(s, days, 'prev'), totals = totalsOf(cur, s);
  const mine = NAMED.filter(x => x.site === s.id);
  const recent = [
    ...mine.map(x => ({ ts: stamp(x.ago), name: x.name, event: 'pageview', path: PATHS[s.id][0], country: x.country, city: x.city, device: x.device, browser: x.browser, referrer: 'linkedin.com' })),
    ...mine.filter(x => x.actions).map(x => ({ ts: stamp(x.ago - 1), name: x.name, event: EVENTS[x.actions % EVENTS.length], path: '/', country: x.country, city: x.city, device: x.device, browser: x.browser, referrer: '' })),
    { ts: stamp(4), name: null, event: 'pageview', path: PATHS[s.id][1] ?? '/', country: 'US', city: 'Chicago', device: 'Mobile', browser: 'Safari', referrer: 'google.com' },
    { ts: stamp(11), name: null, event: 'pageview', path: '/', country: 'DE', city: 'Munich', device: 'Desktop', browser: 'Firefox', referrer: '' },
  ].sort((a, b) => b.ts.localeCompare(a.ts));
  return {
    totals, prev: totalsOf(prev, s), daily: cur, live: s.live, days,
    paths: split(PATHS[s.id], totals.views, `${s.id}p`), countries: split(COUNTRIES, totals.visitors, `${s.id}c`),
    referrers: split(REFS, totals.visitors, `${s.id}r`), devices: split(DEVICES, totals.visitors, `${s.id}d`),
    custom: totals.views ? [{ label: 'clicked-email', n: 6 }, { label: 'downloaded-resume.pdf', n: 4 }, { label: 'outbound-github.com', n: 3 }] : [],
    campaigns: totals.views ? [{ label: 'linkedin · social · job-search', n: 9, acted: 3 }, { label: 'github · profile', n: 4, acted: 1 }] : [],
    named: mine.map(x => ({ name: x.name, visits: x.visits, actions: x.actions, last_seen: stamp(x.ago), city: x.city, country: x.country, device: x.device })),
    recent,
  };
}

export function demoVisitor(siteId, name) {
  const v = NAMED.find(x => x.name === name && x.site === siteId);
  if (!v) return null;
  const r = rng(`${siteId}|${name}`), pages = PATHS[siteId];
  const events = Array.from({ length: v.visits + v.actions }, (_, i) => {
    const action = i >= v.visits;
    return { ts: stamp(v.ago + i * 55 + Math.floor(r() * 40)), event: action ? EVENTS[i % EVENTS.length] : 'pageview', path: pages[i % pages.length], referrer: i === v.visits - 1 ? 'linkedin.com' : '', country: v.country, city: v.city, device: v.device, browser: v.browser };
  }).sort((a, b) => b.ts.localeCompare(a.ts));
  return { name, visits: v.visits, actions: v.actions, devices: 1, first_seen: events.at(-1).ts, last_seen: events[0].ts, campaign: 'linkedin · social · job-search', events };
}

export const demoSettings = () => ({ retentionDays: 180, cronConfigured: true, sites: DEMO_SITES.map(s => ({ site_id: s.id, total: 4200, oldest: stamp(60 * 24 * 90) })) });
