// 例: v1.4.3-2 に上げる
const CACHE = 'trainpunch-1.4.3-2';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.4.3b',   // ← index と合わせる
  './app.js?v=1.4.3',
  './sw-register.js',
  './manifest.webmanifest',
  './privacy.html',
  './support.html',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  // 次回リロードで切替（自動 skipWaiting はしない）
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      ASSETS.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      )
    );
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 必要時のみ即時有効化
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // ---- HTMLナビ（Safari対策で Accept 判定も含める）----
  const isHTMLNav =
    req.method === 'GET' &&
    (req.mode === 'navigate' ||
     (req.headers.get('accept') || '').includes('text/html'));

  if (isHTMLNav) {
    e.respondWith((async () => {
      try {
        // なるべく最新を取得
        const res = await fetch(req);
        // 成功したら同一オリジンのみキャッシュ更新（任意）
        if (res && res.ok && req.url.startsWith(self.location.origin)) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (_) {
        const cache = await caches.open(CACHE);
        // 1) まず“そのページ自身”のキャッシュ（support.html等）を試す
        const cachedPage = await cache.match(req, { ignoreSearch: true });
        if (cachedPage) return cachedPage;
        // 2) ダメなら SPA 用に index.html を返す
        const index = await cache.match('./index.html', { ignoreSearch: true });
        return index || new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // ---- 通常リクエスト：キャッシュ優先 → ネット → 成功したら保存 ----
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;

    try {
      const res = await fetch(req);
      if (res && res.ok && req.method === 'GET' && req.url.startsWith(self.location.origin)) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (_) {
      return hit || Response.error();
    }
  })());
});