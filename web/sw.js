// Open Seats service worker: makes the app installable and lets the shell open
// instantly. Network first, so a code change shows on the next load; the cache is
// only a fallback. It never touches /api, /auth, /callback or /local: schedule
// data and anything token-related always go to the local server, never a cache.
const CACHE = 'open-seats-shell-v1';
const SHELL = [
  '/', '/index.html', '/styles.css', '/manifest.webmanifest',
  '/js/main.js', '/js/api.js', '/js/model.js', '/js/render.js',
  '/js/planner.js', '/js/route.js', '/js/ideas.js', '/js/venues.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];
const PRIVATE = /^\/(api|auth|callback|local)(\/|$)/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || PRIVATE.test(url.pathname)) return;
  const key = url.pathname === '/' ? '/index.html' : url.pathname; // query strings are view state, same file
  e.respondWith(fetch(e.request)
    .then((res) => {
      if (res.ok && SHELL.includes(url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    })
    .catch(() => caches.match(key)));
});
