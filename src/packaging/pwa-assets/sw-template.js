// {{APP_NAME}} - Service Worker v{{APP_VERSION}}
// Gelişmiş offline support ve otomatik güncelleme

const CACHE_NAME = '{{CACHE_NAME}}';
const CRITICAL_CACHE = '{{CACHE_NAME}}-critical';
const RUNTIME_CACHE = '{{CACHE_NAME}}-runtime';

// Tüm dosya listesi
const ALL_FILES = [
  {{CRITICAL_FILES_LIST}}
];

// Kritik dosyalar (install sırasında hemen cache'lenir)
const CRITICAL_FILES = ALL_FILES.filter(file => {
  return file === '/' ||
         file === '/index.html' ||
         file === '/manifest.json' ||
         file === '/ico.png' ||
         file === '/download-manager.js' ||
         file === '/pwa-config.json' ||
         file.startsWith('/scripts/') ||
         file.startsWith('/styles/') ||
         file.startsWith('/images/logo');
});

// Install event - kritik dosyaları cache'le
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  console.log('[SW] Critical files:', CRITICAL_FILES.length);
  
  event.waitUntil(
    caches.open(CRITICAL_CACHE)
      .then((cache) => {
        console.log('[SW] Caching critical files...');
        // Kritik dosyaları cache'le, hata olursa devam et
        return Promise.allSettled(
          CRITICAL_FILES.map(url => 
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url);
              return null;
            })
          )
        );
      })
      .then((results) => {
        const successful = results.filter(r => r.status === 'fulfilled').length;
        console.log(`[SW] ${successful}/${CRITICAL_FILES.length} critical files cached`);
        return self.skipWaiting(); // Hemen aktif et
      })
      .catch((error) => {
        console.error('[SW] Installation failed:', error);
        return self.skipWaiting();
      })
  );
});

// Activate event - eski cache'leri temizle ve tüm dosyaları cache'le
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    Promise.all([
      // Eski cache'leri temizle
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CRITICAL_CACHE && 
                cacheName !== RUNTIME_CACHE &&
                cacheName.startsWith('{{CACHE_PREFIX}}')) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Hemen kontrol al
      self.clients.claim()
    ])
    .then(() => {
      console.log('[SW] Service worker activated');
      // Arka planda tüm dosyaları cache'le
      cacheAllFiles();
    })
  );
});

// Tüm dosyaları arka planda cache'le
async function cacheAllFiles() {
  console.log('[SW] Starting background cache of all files...');
  console.log('[SW] Total files to cache:', ALL_FILES.length);
  
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    
    // Dosyaları küçük gruplar halinde cache'le (aynı anda 10 dosya)
    const batchSize = 10;
    let cached = 0;
    let failed = 0;
    
    for (let i = 0; i < ALL_FILES.length; i += batchSize) {
      const batch = ALL_FILES.slice(i, i + batchSize);
      
      await Promise.allSettled(
        batch.map(url => 
          cache.add(url)
            .then(() => {
              cached++;
              if (cached % 50 === 0) {
                console.log(`[SW] Progress: ${cached}/${ALL_FILES.length} files cached`);
              }
            })
            .catch(err => {
              failed++;
              return null;
            })
        )
      );
      
      // Her batch'ten sonra biraz bekle (tarayıcıyı yavaşlatma)
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`[SW] ✅ Background caching complete: ${cached} cached, ${failed} failed`);
    
    // Tüm client'lara bildir
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_COMPLETE',
        cached: cached,
        failed: failed,
        total: ALL_FILES.length
      });
    });
  } catch (error) {
    console.error('[SW] Background caching error:', error);
  }
}

// Fetch event - cache-first stratejisi
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Sadece GET isteklerini cache'le
  if (event.request.method !== 'GET') {
    return;
  }

  // Chrome extension isteklerini ignore et
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // Harici kaynakları (CDN, API) ignore et - sessizce fail et
  const isExternal = url.origin !== self.location.origin;
  const isGoogleAPI = url.hostname.includes('google.com') || url.hostname.includes('googleapis.com');
  const isCDN = url.hostname.includes('cdnjs.cloudflare.com');
  
  if (isExternal && (isGoogleAPI || isCDN)) {
    // Harici kaynaklar için network-only, hata olursa sessiz
    event.respondWith(
      fetch(event.request).catch(() => {
        // Sessizce başarısız ol, console'a spam yapma
        return new Response('', { status: 404, statusText: 'Offline - External resource unavailable' });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Cache'de var, hemen döndür
          return cachedResponse;
        }

        // Cache'de yok, network'ten al
        return fetch(event.request)
          .then((response) => {
            // Geçerli response değilse cache'leme
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }

            // Response'u klonla (bir kere okunabilir)
            const responseToCache = response.clone();

            // Runtime cache'e ekle (sadece kendi origin'imiz)
            if (!isExternal) {
              caches.open(RUNTIME_CACHE)
                .then((cache) => {
                  cache.put(event.request, responseToCache).catch(() => {
                    // Cache hatası - sessizce ignore et
                  });
                });
            }

            return response;
          })
          .catch((error) => {
            // Offline fallback
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
            
            // Diğer kaynaklar için boş response döndür (sessizce fail)
            return new Response('', { status: 404, statusText: 'Offline' });
          });
      })
  );
});

// Background sync - offline'da yapılan işlemleri sync et
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(syncData());
  }
});

async function syncData() {
  console.log('[SW] Syncing data...');
  // Burada offline'da yapılan işlemleri sync edebilirsiniz
}

// Push notification desteği
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '{{APP_NAME}}';
  const options = {
    body: data.body || 'Yeni bildirim',
    icon: '/ico.png',
    badge: '/ico.png',
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});
