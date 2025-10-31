// Train Punch SW (v1.5.1)
// - 1ファイルのVERSIONでapp.js/styles.cssのクエリを統一
// - SPAナビ: preload→network→同一ページ→index.html の順でフォールバック
// - ignoreSearchはHTMLだけに適用（資産はクエリでバージョン固定）
// - 旧キャッシュ掃除 / navigationPreload 有効化
// - 自動 skipWaiting なし（message で任意反映）

const VERSION = '1.5.1';
const CACHE   = `trainpunch-${VERSION}`;
const ORIGIN  = self.location.origin;
const Q       = `?v=${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  `./styles.css${Q}`,
  `./app.js${Q}`,
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
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      )
    );
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 可能ならナビゲーションPreloadを有効化（表示の体感を改善）
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    // 古いキャッシュは掃除
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 必要時のみ即時有効化（任意）
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // ---- HTMLナビ（Safari対策で Accept 判定も含める）----
  const isHTMLNav =
    req.method === 'GET' &&
    (req.mode === 'navigate' ||
     (req.headers.get('accept') || '').includes('text/html'));

  if (isHTMLNav) {
    e.respondWith((async () => {
      // 1) navigation preload
      try {
        const preload = await e.preloadResponse;
        if (preload) {
          if (url.origin === ORIGIN) {
            const cache = await caches.open(CACHE);
            cache.put(req, preload.clone()).catch(()=>{});
          }
          return preload;
        }
      } catch (_) {}

      // 2) ネット（成功したら同一オリジンに限りキャッシュ更新）
      try {
        const res = await fetch(req);
        if (res && res.ok && url.origin === ORIGIN) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone()).catch(()=>{});
        }
        return res;
      } catch (_) {
        // 3) そのページ自身のキャッシュ → 4) SPAとして index.html
        const cache = await caches.open(CACHE);
        const own   = await cache.match(req, { ignoreSearch: true });
        if (own) return own;
        const index = await cache.match('./index.html', { ignoreSearch: true });
        return index || new Response('<!doctype html><title>offline</title>', {
          status: 200, headers: { 'Content-Type': 'text/html' }
        });
      }
    })());
    return;
  }

  // ---- 非HTML（静的資産）：キャッシュ優先 → ネット成功時に保存 ----
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;

    try {
      const res = await fetch(req);
      if (res && res.ok && req.method === 'GET' && url.origin === ORIGIN) {
        cache.put(req, res.clone()).catch(()=>{});
      }
      return res;
    } catch (_) {
      return hit || Response.error();
    }
  })());
});