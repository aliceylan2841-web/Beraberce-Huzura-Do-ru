// Cemaatim - Service Worker v4.0
const CACHE = 'cemaatim-v4';
const STATIC = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API isteklerini her zaman ağdan çek, hata olursa geçir
  if (url.hostname.includes('onrender.com') || url.hostname.includes('nominatim') || url.hostname.includes('api.aladhan')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({error:'offline'}), {headers:{'Content-Type':'application/json'}}))
    );
    return;
  }
  // Statik dosyalar için cache-first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => new Response('Offline', {status: 503})))
  );
});

// Push bildirimi al
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Namaz Vakti', {
      body: data.body || 'Namaz vakti geldi!',
      icon: data.icon || '/icon-192.png',
      badge: '/badge-72.png',
      tag: data.tag || 'namaz',
      requireInteraction: true,
      actions: [
        {action: 'kildim', title: '✅ Kıldım'},
        {action: 'snooze', title: '⏱ 5 dk Ertele'}
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'kildim') {
    e.waitUntil(
      self.clients.matchAll({type:'window'}).then(clients => {
        if (clients.length) { clients[0].focus(); clients[0].postMessage({type:'kildim'}); }
        else self.clients.openWindow('/');
      })
    );
  } else if (e.action === 'snooze') {
    // 5dk sonra tekrar bildirim gönder
    setTimeout(() => {
      self.registration.showNotification('Namaz Vakti - Hatırlatma', {
        body: 'Namazı kılmayı unutmayın!',
        tag: 'namaz-snooze',
        requireInteraction: true
      });
    }, 300000);
  } else {
    e.waitUntil(self.clients.openWindow('/'));
  }
});
