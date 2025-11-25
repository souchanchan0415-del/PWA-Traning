// Train Punch Service Worker — v1.1.2 (auto update)
// - VERSION ごとにキャッシュ名を分離
// - HTML: navigationPreload + ネット優先 → 同一ページキャッシュ → index.html
// - JS/CSS/画像など: ネット優先 → 成功時にキャッシュ更新 → オフライン時はキャッシュ
// - install で skipWaiting() して新 SW を即アクティブ化
// - activate で旧キャッシュ掃除 + clients.claim()

const VERSION = '1.1.2';
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
  `./app-data.js${Q}`,        // 種目データ＆ワンポイント
  `./app-analytics.js${Q}`,   // ★ 追加：解析用ヘルパー
  `./app.js${Q}`,
  `./sw-register.js${Q}`,
  './manifest.webmanifest',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// スコープ絶対URL（Safari等での相対key不一致を避ける）
const INDEX_ABS = new URL('./index.html', self.registration.scope).toString();

// ===== install =====
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      )
    );

    // ★ 新しい SW を即座に有効化（待機しない）
    self.skipWaiting();
  })());
});

// ===== activate =====
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // navigation preload 有効化（対応ブラウザのみ）
    try { await self.registration.navigationPreload?.enable(); } catch (_) {}

    // 古いキャッシュ掃除
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    );

    // 既存タブも新 SW 管理下へ
    await self.clients.claim();
  })());
});

// 必要時のみ即時有効化（sw-register.js からの明示メッセージにも対応は残す）
self.addEventListener('message', (e) => {
  if (e?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ===== fetch =====
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

  // ---- HTMLナビ（SPA遷移含む）----
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
            c.put(req, preload.clone()).catch(() => {});
          }
          return preload;
        }
      } catch (_) {}

      // 2) ネット（成功したら同一オリジンに限りキャッシュ更新）
      try {
        const res = await fetch(req);
        if (res && res.ok && url.origin === ORIGIN) {
          const c = await caches.open(CACHE);
          c.put(req, res.clone()).catch(() => {});
        }
        return res;
      } catch (_) {
        // 3) そのページ自身のキャッシュ（クエリ無視）→ 4) index.html
        const c = await caches.open(CACHE);
        const own = await c.match(req, { ignoreSearch: true });
        if (own) return own;

        const index =
          await c.match(INDEX_ABS, { ignoreSearch: true }) ||
          await c.match('./index.html', { ignoreSearch: true });

        return (
          index ||
          new Response(
            '<!doctype html><title>offline</title><h1>Offline</h1>',
            {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }
          )
        );
      }
    })());
    return;
  }

  // ---- 非HTML（静的資産）：ネット優先 → キャッシュFallback ----
  event.respondWith((async () => {
    const c = await caches.open(CACHE);

    // 1) まずネットを取りに行く（オンライン時は常に最新を取得）
    try {
      const res = await fetch(req);
      if (res && res.ok && url.origin === ORIGIN) {
        c.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (_) {
      // 2) オフライン等で失敗したらキャッシュから
      const hit = await c.match(req);
      if (hit) return hit;
      return Response.error();
    }
  })());
});