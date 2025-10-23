// Train Punch SW (v1.3.3) — cache bust + SPA nav fallback + SWR for CSS/JS
const CACHE = 'trainpunch-1.3.3';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.3.3',
  './app.js?v=1.3.3',
  './sw-register.js',
  './manifest.webmanifest',
  './privacy.html',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      ASSETS.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {}))
    );
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // --- SPA navigation: network (or preload) -> cache fallback ---
  if (req.mode === 'navigate' && req.method === 'GET') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        return preload || await fetch(req);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) ||
               new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // --- SWR for same-origin CSS/JS ---
  const isStatic = url.origin === self.location.origin && /\.(?:css|js)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const fetching = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await fetching) || Response.error();
    })());
    return;
  }

  // --- Default: cache-first, then network; on success, add to cache ---
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && req.method === 'GET' && url.origin === self.location.origin) {
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return cached || Response.error();
    }
  })());
});