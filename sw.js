// Offline support for the hosted app. Network first, so new versions and AJC_DATA.csv
// show up as soon as you're online; the cached copy is used only when offline.
var CACHE = 'tirzepatide-log-v1';
var CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin || /[?&](code|state)=/.test(req.url)) return;  // never cache the sign-in redirect
  ev.respondWith(fetch(req, { cache: 'no-store' }).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
    });
  }));
});
