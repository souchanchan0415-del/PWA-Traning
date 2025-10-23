const CACHE = 'trainpunch-1.3.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.3.0',
  './app.js?v=1.3.0',
  './sw-register.js',
  './manifest.webmanifest',
  './privacy.html',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // 1) HTTPキャッシュをバイパスして常に最新を取る
      await c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 2) SPAナビゲーションでも index.html を返す（オフライン許容）
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // navigation requests → app shell
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(new Request('./index.html', { cache: 'reload' }));
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match('./index.html');
          return cached || new Response('offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // asset: cache-first → network fallback
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => caches.match('./index.html')))
  );
});