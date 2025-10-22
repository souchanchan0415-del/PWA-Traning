const CACHE = 'trainpunch-1.1.1';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1.1.0',
  './app.js?v=1.1.1',
  './sw-register.js',
  './manifest.webmanifest',
  './privacy.html',
  './beep.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).catch(()=>cached)));
});
