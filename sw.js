// Train Punch SW (v1.3.3) — cache bust + SPA nav fallback
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

self.addEventListener('install', (e)=>{
  self.skipWaiting();
  e.waitUntil((async ()=>{
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(url =>
      cache.add(new Request(url, {cache:'reload'})).catch(()=>{})
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

// 任意: waiting を即時有効化できるように
self.addEventListener('message', (e)=>{
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;

  // SPAナビ: 失敗時は index.html
  if (req.mode === 'navigate' && req.method === 'GET'){
    e.respondWith((async ()=>{
      try { return await fetch(req); }
      catch(_){
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) ||
               new Response('', {status:200, headers:{'Content-Type':'text/html'}});
      }
    })());
    return;
  }

  // 通常: まずキャッシュ、なければネット→成功したら保存
  e.respondWith((async ()=>{
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try{
      const res = await fetch(req);
      if(res && res.ok && req.method==='GET' && req.url.startsWith(self.location.origin)){
        cache.put(req, res.clone());
      }
      return res;
    }catch(_){
      return hit || Response.error();
    }
  })());
});