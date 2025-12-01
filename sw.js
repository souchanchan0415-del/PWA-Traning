// Service Worker for Train Punch
const CACHE_NAME = 'train-punch-cache-v49';

const ASSETS = [
  './',
  './index.html',
  './session.html',
  './analysis.html',
  './history.html',
  './settings.html',
  './shop.html',
  './blog.html',
  './post.html',          // ★ 個別記事ページ
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './posts/index.json'    // ★ ブログ目次データ
  // 各記事の .txt は都度 fetch するので、今はキャッシュしない運用
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      return (
        cached ||
        fetch(req).catch(() => {
          if (req.mode === 'navigate') {
            // オフライン時はとりあえず session.html を返す
            return caches.match('./session.html') || caches.match('./index.html');
          }
        })
      );
    })
  );
});