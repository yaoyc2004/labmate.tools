/* labmate.tools — 10.1 Protocol Timeline Planner: offline copy of this one tool.
 * Scope: /tools/protocol-timeline/ only. The page is fetched fresh when online and served from the
 * cache when not; its scripts, styles and fonts are versioned (?v=), so they are served from the cache.
 */
var V = 'lmt-timeline-2';
var PAGE = new URL('./', self.registration.scope).href;

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(function (c) { return c.add(PAGE); }).catch(function () { /* offline at install */ }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('lmt-timeline-') === 0 && k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function wanted(u) {
  return u.origin === self.location.origin || /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
}

// The page tells us what it loaded before this worker was running.
self.addEventListener('message', function (e) {
  var urls = (e.data && e.data.cache) || [];
  e.waitUntil(caches.open(V).then(function (c) {
    return Promise.all(urls.map(function (raw) {
      var u; try { u = new URL(raw); } catch (x) { return null; }
      if (!wanted(u)) return null;
      var key = u.href === PAGE || u.href.split('?')[0] === PAGE ? PAGE : u.href;
      return c.match(key).then(function (hit) {
        if (hit) return null;
        var same = u.origin === self.location.origin;
        return fetch(u.href, same ? {} : { mode: 'no-cors' }).then(function (r) { if (r.ok || r.type === 'opaque') return c.put(key, r); }).catch(function () { /* skip */ });
      });
    }));
  }));
});

self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  if (!wanted(u)) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(function (res) {
      if (res.ok) { var cp = res.clone(); caches.open(V).then(function (c) { c.put(PAGE, cp); }); }
      return res;
    }).catch(function () {
      return caches.match(PAGE).then(function (hit) { return hit || Response.error(); });
    }));
    return;
  }
  e.respondWith(caches.match(r).then(function (hit) {
    return hit || fetch(r).then(function (res) {
      if (res.ok || res.type === 'opaque') { var cp = res.clone(); caches.open(V).then(function (c) { c.put(r, cp); }); }
      return res;
    });
  }));
});
