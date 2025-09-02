const CACHE_NAME = 'fw-site-v2';
const ASSETS = [
  './',
  './index.html',
  './about.html',
  './publications.html',
  './blog.html',
  './contact.html',
  './style.css',
  './script.js',
  './lang.js',
  './assets/logo.svg',
  './assets/avatar.svg',
  './assets/og-template.svg',
  './portfolio.json'
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))),
      self.clients.claim()
    ])
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const dest = req.destination; // 'document' | 'style' | 'script' | 'image' | ...

  // Network-first for HTML, CSS and JS to avoid stale UI
  if (dest === 'document' || dest === 'style' || dest === 'script') {
    event.respondWith(
      fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Stale-while-revalidate for other assets (images, fonts, etc.)
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
