// Train Punch SW (v1.3.1) — cache bust + SPA nav fallback
const CACHE = 'trainpunch-1.3.1';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.3.1',
  './app.js?v=1.3.1',
  './sw-register.js',
  './manifest.webmanifest',
  './privacy.html',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e)=>{
  self.skipWaiting();
  e.waitUntil(
    (async ()=>{
      const cache = await caches.open(CACHE);
      // HTTP キャッシュをバイパスして確実に最新を保存
      await Promise.all(
        ASSETS.map(url => cache.add(new Request(url, {cache:'reload'})).catch(()=>{}))
      );
    })()
  );
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    (async ()=>{
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;

  // SPA ナビゲーション: オフライン時は index.html を返す
  const isNav = req.mode === 'navigate' && req.method === 'GET';
  if (isNav){
    e.respondWith(
      (async ()=>{
        try{
          const fresh = await fetch(req);
          return fresh;
        }catch(_){
          const cache = await caches.open(CACHE);
          const fallback = await cache.match('./index.html');
          return fallback || new Response('', {status: 200, headers:{'Content-Type':'text/html'}});
        }
      })()
    );
    return;
  }

  // 通常リクエスト: Cache, falling back to network, and cache update
  e.respondWith(
    (async ()=>{
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;

      try{
        const res = await fetch(req);
        if(res && res.ok && req.method==='GET' && (req.url.startsWith(self.location.origin))){
          cache.put(req, res.clone());
        }
        return res;
      }catch(_){
        return cached || Response.error();
      }
    })()
  );
});