'use strict';
// Comprueba que el service worker no vuelva a cachear las llamadas a la API.
// Ese fue el bug que borraba pedidos: la app recibía una lista vieja de la caché
// y la volvía a subir a la nube.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { REPO, makeReporter, runStandalone } = require('./helpers');

async function run(check) {
  const code = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
  const handlers = {};
  const cacheStub = {
    match: () => Promise.resolve(undefined),
    put: () => Promise.resolve(),
    add: () => Promise.resolve(),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve()
  };
  const ctx = {
    self: {
      addEventListener: (t, f) => { handlers[t] = f; },
      skipWaiting() {}, claim() {},
      clients: { claim() {}, matchAll: () => Promise.resolve([]), openWindow() {} },
      registration: { showNotification() {} }
    },
    caches: {
      open: () => Promise.resolve(cacheStub),
      match: () => Promise.resolve(undefined),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true)
    },
    fetch: () => Promise.resolve(new Response('x', { status: 200 })),
    Response, Request, URL, console
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  // Devuelve true si el service worker se encarga de la petición (la cachea).
  const intercepts = (url, mode, method) => {
    let handled = false;
    handlers.fetch({
      request: { method: method || 'GET', mode: mode || 'cors', url, clone: () => ({}) },
      respondWith: () => { handled = true; }
    });
    return handled;
  };

  check('registra el manejador de fetch', typeof handlers.fetch === 'function');
  check('registra el manejador de push', typeof handlers.push === 'function');

  console.log('\n-- la API (Netlify Functions) NUNCA debe cachearse --');
  check('GET /.netlify/functions/orders pasa a la red',
    !intercepts('https://x.netlify.app/.netlify/functions/orders'),
    'lo cachearía: la app leería pedidos viejos y los subiría, borrando los nuevos');
  check('GET /.netlify/functions/health pasa a la red',
    !intercepts('https://x.netlify.app/.netlify/functions/health'), 'lo cachearía');
  check('GET /.netlify/functions/calendar pasa a la red',
    !intercepts('https://x.netlify.app/.netlify/functions/calendar'), 'lo cachearía');
  check('POST /.netlify/functions/orders no se toca',
    !intercepts('https://x.netlify.app/.netlify/functions/orders', 'cors', 'POST'));

  console.log('\n-- lo demás sí se gestiona (para que funcione sin conexión) --');
  check('la navegación HTML', intercepts('https://x.netlify.app/', 'navigate'));
  check('index.html', intercepts('https://x.netlify.app/index.html', 'no-cors'));
  check('los iconos', intercepts('https://x.netlify.app/icon-192.png', 'no-cors'));
  check('las fuentes de Google', intercepts('https://fonts.googleapis.com/css2', 'no-cors'));
  check('el cliente de Google', intercepts('https://accounts.google.com/gsi/client', 'no-cors'));
}

module.exports = { name: 'Service worker (qué se cachea y qué no)', run };
if (require.main === module) runStandalone(module.exports);
