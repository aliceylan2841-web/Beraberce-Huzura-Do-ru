// Huzura Doğru – service worker (v5)
// Strateji: önce ağ, ağ yoksa önbellek. Eski sürümlerin önbelleğini siler,
// böylece güncelleme yayınlandığında kullanıcı eski sayfada takılı kalmaz.
const CACHE = 'huzura-v5';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  if (new URL(req.url).origin !== location.origin) return; // dış API/CDN'e karışma
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
  );
});
