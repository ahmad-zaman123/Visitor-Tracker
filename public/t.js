/* Tracker snippet. Usage:
   <script defer src="https://YOUR-TRACKER.vercel.app/t.js" data-site="SITE_ID"></script>
   Name a visitor with a link:  https://yoursite.com/?ref=Sara-Acme
   or in code:                  tracker.identify('Sara')
   Custom events:               tracker.track('opened-projects')                      */
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

  function send(event) {
    var body = JSON.stringify({
      site: site, vid: vid, name: name, event: event || 'pageview',
      path: location.pathname + location.hash,
      referrer: document.referrer ? new URL(document.referrer).hostname : ''
    });
    if (navigator.sendBeacon) navigator.sendBeacon(endpoint, body);
    else fetch(endpoint, { method: 'POST', body: body, keepalive: true });
  }

  window.tracker = {
    track: function (e) { send(String(e)); },
    identify: function (n) { name = String(n).trim(); set('tk_name', name); send('identify'); }
  };

  // Treat hash changes as page views (the portfolio uses #plain).
  send();
  window.addEventListener('hashchange', function () { send(); });
})();
