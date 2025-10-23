// sw.js
const CACHE = 'trainpunch-1.2.1';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.2.1',
  './app.js?v=1.2.1',
  './sw-register.js',
  './manifest.webmanifest',
  './privacy.html',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 1) インストール時：HTTPキャッシュをバイパスして確実に最新を取得
self.addEventListener('install', (e) => {
  self.skipWaiting(); // 新SWを即時アクティブ化
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))
    )
  );
});

// 有効化：旧キャッシュを掃除して既存タブも新SWに切替
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 2) SPAナビゲーション：オンラインならネット優先、オフラインなら index.html をフォールバック
self.addEventListener('fetch', (e) => {
  const req = e.request;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        // 最新を取りにいく
        return await fetch(req);
      } catch {
        // オフライン時はキャッシュ済みの App Shell
        const cached = await caches.match('./index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // 静的アセット等：キャッシュ優先＋ネットフォールバック
  e.respondWith(
    caches.match(req).then(cached =>
      cached || fetch(req).catch(() => cached)
    )
  );
});