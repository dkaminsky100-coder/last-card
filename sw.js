// Service worker: lets Last Card install as an app and run offline.
//
// Same-origin files are fetched network-first (so edits show up on the next
// load while online) with the cache as the offline fallback. Google Fonts are
// cache-first since their URLs are versioned.

const CACHE = 'lastcard-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'src/main.js',
  'src/engine.js',
  'src/bots.js',
  'src/ui.js',
  'src/rng.js',
  'src/sound.js',
  'src/stats.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      })),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
