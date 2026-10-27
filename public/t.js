/* Tracker snippet. Usage:
   <script defer src="https://YOUR-TRACKER.vercel.app/t.js" data-site="SITE_ID"></script>
   Name a visitor with a link:  https://yoursite.com/?ref=Sara-Acme
   or in code:                  tracker.identify('Sara')
   Custom events:               tracker.track('opened-projects')
   Campaigns:                   https://yoursite.com/?utm_source=linkedin&utm_campaign=job-oct
   Clicks are logged on their own: email and phone links, file downloads (pdf, docx, zip...)
   and links to other sites. Skip a link with data-track="off", or all of it with data-auto="off" on this script. */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var site = s.getAttribute('data-site');
  var endpoint = new URL('/api/collect', s.src).href;
  if (!site || navigator.doNotTrack === '1') return;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var vid = get('tk_vid');
  if (!vid) {
    vid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    set('tk_vid', vid);
  }

  var params = new URLSearchParams(location.search);
  var fromLink = params.get('ref') || params.get('name');
  if (fromLink) set('tk_name', fromLink.replace(/[-_+]/g, ' ').trim());
  var name = get('tk_name');

  // Campaign tags stay with the tab, so the downloads and clicks that follow are credited to them.
  var utm = null;
  try { utm = JSON.parse(sessionStorage.getItem('tk_utm') || 'null'); } catch (e) {}
  var us = params.get('utm_source'), um = params.get('utm_medium'), uc = params.get('utm_campaign');
  if (us || um || uc) {
    utm = { source: us, medium: um, campaign: uc };
    try { sessionStorage.setItem('tk_utm', JSON.stringify(utm)); } catch (e) {}
  }

  function send(event) {
    var body = JSON.stringify({
      site: site, vid: vid, name: name, event: event || 'pageview',
      path: location.pathname + location.hash, utm: utm,
      referrer: document.referrer ? new URL(document.referrer).hostname : ''
    });
    if (navigator.sendBeacon) navigator.sendBeacon(endpoint, body);
    else fetch(endpoint, { method: 'POST', body: body, keepalive: true });
  }

  window.tracker = {
    track: function (e) { send(String(e)); },
    identify: function (n) { name = String(n).trim(); set('tk_name', name); send('identify'); }
  };

  // Automatic click events: mailto:, tel:, file downloads and outbound links.
  if (s.getAttribute('data-auto') !== 'off') {
    var FILE = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|rar|7z|txt|rtf)$/i, last = '', lastAt = 0;
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.getAttribute('data-track') === 'off') return;
      var ev = '', u;
      try { u = new URL(a.href, location.href); } catch (err) { return; }
      if (u.protocol === 'mailto:') ev = 'clicked-email';
      else if (u.protocol === 'tel:') ev = 'clicked-phone';
      else if (u.protocol === 'http:' || u.protocol === 'https:') {
        var file = decodeURIComponent(u.pathname.split('/').pop() || '');
        if (FILE.test(file)) ev = 'downloaded-' + file;
        else if (a.hasAttribute('download')) ev = 'downloaded-' + (a.getAttribute('download') || file || 'file');
        else if (u.hostname !== location.hostname) ev = 'outbound-' + u.hostname.replace(/^www\./, '');
      }
      if (!ev) return;
      var now = Date.now();
      if (ev === last && now - lastAt < 1000) return; // double clicks
      last = ev; lastAt = now;
      send(ev.slice(0, 60));
    }, true);
  }

  // Treat hash changes as page views (the portfolio uses #plain).
  send();
  window.addEventListener('hashchange', function () { send(); });
})();
