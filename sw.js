const CACHE_NAME = 'fw-site-v4';
const ASSETS = [
  './',
  './index.html',
  './about.html',
  './publications.html',
  './blog.html',
  './contact.html',
  './404.html',
  './style.css',
  './script.js',
  './lang.js',
  './manifest.webmanifest',
  './assets/logo.svg',
  './assets/avatar.svg',
  // Keep only critical assets; large images should be fetched on demand
  './portfolio.json',
  './assets/data/profile.json'
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
  // Only handle same-origin requests; let the browser handle cross-origin (CDNs, APIs)
  try {
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
  } catch {
    return;
  }
  const dest = req.destination; // 'document' | 'style' | 'script' | 'image' | ...

  // Network-first for HTML, CSS and JS to avoid stale UI
  if (dest === 'document' || dest === 'style' || dest === 'script') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          const clone = res.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(()=>{}));
        }
        return res;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || Promise.reject(e);
      }
    })());
    return;
  }

  // Stale-while-revalidate for other assets (images, fonts, etc.)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const clone = res.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(()=>{}));
      }
      return res;
    }).catch(() => cached);
    return cached || fetchPromise;
  })());
});
