// Train Punch SW (v1.4.3) — cache bust + SPA nav fallback (+ignoreSearch, no auto skipWaiting)
const CACHE = 'trainpunch-1.4.3';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.4.3',
  './app.js?v=1.4.3',
  './sw-register.js',
  './manifest.webmanifest',
  './privacy.html',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e)=>{
  // 自動の skipWaiting はしない（待機 → 次回リロードで適用）
  e.waitUntil((async ()=>{
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(url =>
      cache.add(new Request(url, { cache:'reload' })).catch(()=>{})
    ));
  })());
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 明示メッセージでのみ即時有効化したい場合のフック（任意）
self.addEventListener('message', (e)=>{
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;

  // SPA ナビ: オフライン時は index.html にフォールバック（ignoreSearch 付き）
  if (req.mode === 'navigate' && req.method === 'GET'){
    e.respondWith((async ()=>{
      try {
        return await fetch(req);
      } catch (_){
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html', { ignoreSearch: true })) ||
               new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // 通常リクエスト: 先にキャッシュ、なければネット→成功したら保存（同一オリジンのみ）
  e.respondWith((async ()=>{
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try{
      const res = await fetch(req);
      if (res && res.ok && req.method === 'GET' && req.url.startsWith(self.location.origin)){
        cache.put(req, res.clone());
      }
      return res;
    }catch(_){
      return hit || Response.error();
    }
  })());
});