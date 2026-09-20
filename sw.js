/* Service Worker — Rican's Sweets by Fany
   - index.html se sirve con network-first (las actualizaciones llegan de inmediato).
   - Iconos/logo se sirven con cache-first (rápidos y disponibles offline). */
const CACHE = 'ricans-sweets-v3';
const ASSETS = [
  './',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

// La caché de fuentes/scripts de Google no crece sin control: se limita y se van
// quitando las entradas más antiguas. Solo se tocan entradas de Google; las de
// la app (el HTML, los iconos) nunca se borran desde aquí.
const GOOGLE_CACHE_MAX = 40;
function trimGoogleCache(){
  const isGoogleUrl = (u) => {
    try {
      const h = new URL(u).hostname;
      return h.indexOf('googleapis.com') !== -1 ||
             h.indexOf('gstatic.com') !== -1 ||
             h.indexOf('accounts.google.com') !== -1;
    } catch (e) { return false; }
  };
  return caches.open(CACHE)
    .then((c) => c.keys().then((keys) => {
      const google = keys.filter((r) => isGoogleUrl(r.url));
      const excess = google.length - GOOGLE_CACHE_MAX;
      if (excess <= 0) return undefined;
      return Promise.all(google.slice(0, excess).map((r) => c.delete(r)));
    }))
    .catch(() => {});
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Llamadas a la API (Netlify Functions): el service worker NO las toca.
  // Antes caían en la rama cache-first del final, así que la app recibía una
  // lista de pedidos congelada en caché y la volvía a subir al backend: eso
  // borraba los pedidos creados después de la primera visita. Al salir sin
  // llamar a respondWith, la petición sigue su curso normal hacia la red.
  if (url.pathname.indexOf('/.netlify/functions/') !== -1) return;

  // Google (fuentes y scripts): network-first con respaldo en caché.
  const isGoogle = url.hostname.includes('googleapis.com') ||
                   url.hostname.includes('gstatic.com') ||
                   url.hostname.includes('accounts.google.com');
  if (isGoogle) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).then(trimGoogleCache);
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || Response.error()))
    );
    return;
  }

  // Páginas HTML / navegación: network-first para que las actualizaciones lleguen,
  // con respaldo en caché si no hay conexión.
  const isHtml = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  if (isHtml) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() =>
        caches.match(req)
          .then((cached) => cached || caches.match('./'))
          .then((cached) => cached || new Response(
            '<!DOCTYPE html><meta charset="utf-8"><title>Sin conexión</title>' +
            '<body style="font-family:sans-serif;background:#0B0B0C;color:#F6F0E4;text-align:center;padding:40px">' +
            '<h1 style="color:#D4AF37">Sin conexión</h1>' +
            '<p>Tus pedidos siguen guardados en este dispositivo. Vuelve a abrir la app cuando recuperes internet.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          ))
      )
    );
    return;
  }

  // Resto (iconos, logo, manifest): cache-first con caché en runtime.
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }).catch(() => Response.error())
  );
});

// --- Push (recordatorios de pedidos) ---
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  const title = data.title || "Rican's Sweets";
  const options = {
    body: data.body || 'Tienes pedidos próximos',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
