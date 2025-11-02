// Train Punch Service Worker — v1.5.5-hotfix1
// - 単一 VERSION で app.js / styles.css のクエリを統一（中央管理）
// - SPAナビ: preload → network → 同一ページcache → index.html の順でフォールバック
// - ignoreSearch は HTML のみ（資産はクエリでバージョン固定）
// - 旧キャッシュ掃除 / navigationPreload 有効化
// - 自動 skipWaiting はしない（message: SKIP_WAITING で即時適用）

const VERSION = '1.5.5-hotfix1';
const CACHE   = `trainpunch-${VERSION}`;
const ORIGIN  = self.location.origin;
const Q       = `?v=${VERSION}`;

// 主要ページ（オフラインでも開けるように）
const PAGES = [
  './',
  './index.html',
  './contact.html',
  './privacy.html',
  './support.html',
  './tokusho.html',
  // サポートページで誤リンクする可能性がある場合の保険（存在しなければ無視される）
  './tokushoho.html'
];

// プリキャッシュ資産（CSS/JS は SW の VERSION クエリでキャッシュバスト）
const ASSETS = [
  ...PAGES,
  `./styles.css${Q}`,
  `./app.js${Q}`,
  `./sw-register.js${Q}`,
  './manifest.webmanifest',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      )
    );
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 表示の体感向上（対応ブラウザ）
    try { await self.registration.navigationPreload?.enable(); } catch (_) {}

    // 古いキャッシュ掃除
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));

    await self.clients.claim();
  })());
});

// 必要時のみ即時有効化（sw-register.js から）
self.addEventListener('message', (e) => {
  if (e?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GET 以外は素通し
  if (req.method !== 'GET') return;

  // Range リクエストは素通し（音声の断片取得など）
  if (req.headers.get('range')) {
    event.respondWith(fetch(req));
    return;
  }

  // ---- HTMLナビ（Safari対策で Accept 判定も含む）----
  const isHTMLNav =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTMLNav) {
    event.respondWith((async () => {
      // 1) navigation preload があれば最優先
      try {
        const preload = await event.preloadResponse;
        if (preload) {
          if (url.origin === ORIGIN) {
            const c = await caches.open(CACHE);
            c.put(req, preload.clone()).catch(()=>{});
          }
          return preload;
        }
      } catch (_) {}

      // 2) ネット（成功したら同一オリジンに限りキャッシュ更新）
      try {
        const res = await fetch(req);
        if (res && res.ok && url.origin === ORIGIN) {
          const c = await caches.open(CACHE);
          c.put(req, res.clone()).catch(()=>{});
        }
        return res;
      } catch (_) {
        // 3) そのページ自身のキャッシュ（クエリ無視）→ 4) index.html
        const c = await caches.open(CACHE);
        const own = await c.match(req, { ignoreSearch: true });
        if (own) return own;

        const index = await c.match('./index.html', { ignoreSearch: true });
        return index || new Response('<!doctype html><title>offline</title><h1>Offline</h1>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // ---- 非HTML（静的資産）：キャッシュ優先 → ネット成功時に保存（同一オリジンのみ）----
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if (hit) return hit;

    try {
      const res = await fetch(req);
      if (res && res.ok && url.origin === ORIGIN) {
        c.put(req, res.clone()).catch(()=>{});
      }
      return res;
    } catch (_) {
      return hit || Response.error();
    }
  })());
});