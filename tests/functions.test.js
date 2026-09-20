'use strict';
// Pruebas de las funciones de Netlify: se ejecutan de verdad en un sandbox.
const { callFunction, makeReporter, runStandalone } = require('./helpers');

const PASS = 'secreta';

// fetch falso que distingue el endpoint de tokens de Google de la API de Calendar.
function googleStub(capture) {
  return async (url, init) => {
    const u = String(url);
    if (u.indexOf('oauth2.googleapis.com') !== -1) {
      if (capture && capture.tokenError) {
        return new Response(JSON.stringify({ error: capture.tokenError }),
          { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ access_token: 'AT' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (capture && init && init.body) capture.payload = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'ev1' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const withGoogle = () => ({ oauth: { refresh_token: 'rt' } });

async function run(check) {
  // ---------------------------------------------------------------- puerta ---
  console.log('\n-- puerta de acceso (APP_PASSWORD) --');
  let r;

  r = await callFunction('orders.mjs', { env: {}, method: 'GET' });
  check('sin APP_PASSWORD sigue abierta (no rompe una instalación en marcha)',
    r.status === 200, 'status=' + r.status);

  r = await callFunction('orders.mjs', { env: { APP_PASSWORD: PASS }, method: 'GET' });
  check('con APP_PASSWORD y sin clave -> 401 unauthorized',
    r.status === 401 && r.body.error === 'unauthorized', JSON.stringify(r.body));

  r = await callFunction('orders.mjs', { env: { APP_PASSWORD: PASS }, method: 'GET', key: PASS });
  check('con la clave correcta -> 200', r.status === 200 && Array.isArray(r.body.orders), JSON.stringify(r.body));

  r = await callFunction('orders.mjs', { env: { APP_PASSWORD: PASS }, method: 'GET', key: 'otracla' });
  check('con clave incorrecta del MISMO largo -> 401', r.status === 401, JSON.stringify(r.body));

  r = await callFunction('orders.mjs', { env: { APP_PASSWORD: PASS }, method: 'GET', key: 'x' });
  check('con clave incorrecta de otro largo -> 401', r.status === 401, JSON.stringify(r.body));

  r = await callFunction('orders.mjs', { env: { APP_PASSWORD: PASS }, body: JSON.stringify({ orders: [] }) });
  check('escribir sin clave -> 401 (no se puede vaciar la lista)', r.status === 401, JSON.stringify(r.body));

  r = await callFunction('orders.mjs', {
    env: { APP_PASSWORD: PASS }, key: PASS, body: JSON.stringify({ orders: [{ id: 'a', name: 'Ana' }] })
  });
  check('escribir con clave -> 200 y guarda', r.status === 200 && r.store.orders.length === 1, JSON.stringify(r.store));

  r = await callFunction('health.mjs', { env: {}, method: 'GET' });
  check('health sin APP_PASSWORD -> authRequired:false',
    r.body.authRequired === false && r.body.authorized === true, JSON.stringify(r.body));

  r = await callFunction('health.mjs', { env: { APP_PASSWORD: PASS, VAPID_PUBLIC_KEY: 'PUB' }, method: 'GET' });
  check('health sin clave -> authRequired:true, authorized:false',
    r.body.authRequired === true && r.body.authorized === false, JSON.stringify(r.body));
  check('  y NO entrega la clave pública de push', r.body.pushPublicKey === '', JSON.stringify(r.body.pushPublicKey));

  r = await callFunction('health.mjs', { env: { APP_PASSWORD: PASS, VAPID_PUBLIC_KEY: 'PUB' }, method: 'GET', key: PASS });
  check('health con la clave -> authorized:true y sí entrega pushPublicKey',
    r.body.authorized === true && r.body.pushPublicKey === 'PUB', JSON.stringify(r.body));

  r = await callFunction('calendar.mjs', { env: { APP_PASSWORD: PASS }, body: '{}' });
  check('calendar sin clave -> 401 (no toca el calendario)',
    r.status === 401 && r.body.error === 'unauthorized', JSON.stringify(r.body));

  r = await callFunction('calendar.mjs', { env: { APP_PASSWORD: PASS }, key: PASS, body: '{}' });
  check('calendar con clave -> pasa la puerta', r.body.error === 'no_token', JSON.stringify(r.body));

  r = await callFunction('push.mjs', { env: { APP_PASSWORD: PASS }, body: JSON.stringify({ action: 'test' }) });
  check('push "test" sin clave -> 401 (no se puede mandar spam)', r.status === 401, JSON.stringify(r.body));

  // -------------------------------------------------------------- OAuth CSRF ---
  console.log('\n-- OAuth: nadie puede conectar SU cuenta de Google --');
  r = await callFunction('auth.mjs', { env: { APP_PASSWORD: PASS, GOOGLE_CLIENT_ID: 'cid' }, method: 'GET' });
  check('auth sin ?key -> 401', r.status === 401, 'status=' + r.status);

  r = await callFunction('auth.mjs', {
    env: { APP_PASSWORD: PASS, GOOGLE_CLIENT_ID: 'cid' }, method: 'GET',
    url: 'https://x/.netlify/functions/auth?key=mala'
  });
  check('auth con ?key incorrecta -> 401', r.status === 401, 'status=' + r.status);

  r = await callFunction('auth.mjs', {
    env: { APP_PASSWORD: PASS, GOOGLE_CLIENT_ID: 'cid' }, method: 'GET',
    url: 'https://x/.netlify/functions/auth?key=' + PASS
  });
  const loc = r.location || '';
  const cookie = r.res.headers.get('set-cookie') || '';
  const stateUrl = new URL(loc).searchParams.get('state');
  const stateCookie = (cookie.match(/gstate=([^;]+)/) || [])[1];
  check('auth con ?key correcta -> redirige a Google',
    r.status === 302 && loc.indexOf('https://accounts.google.com/') === 0, loc);
  check('  el state es aleatorio (no la cadena fija "ricans")',
    !!stateUrl && stateUrl !== 'ricans', String(stateUrl));
  check('  y viaja en una cookie HttpOnly + Secure',
    !!stateCookie && stateCookie === stateUrl && /HttpOnly/i.test(cookie) && /Secure/i.test(cookie), cookie);

  r = await callFunction('auth-callback.mjs', {
    env: { APP_PASSWORD: PASS }, method: 'GET',
    url: 'https://x/.netlify/functions/auth-callback?code=C&state=abc'
  });
  check('callback sin cookie de state -> error (rechaza la vuelta ajena)',
    (r.location || '').indexOf('gcal=error') !== -1, r.location);

  r = await callFunction('auth-callback.mjs', {
    env: { APP_PASSWORD: PASS }, method: 'GET',
    url: 'https://x/.netlify/functions/auth-callback?code=C&state=OTRO',
    headers: { cookie: 'gstate=abc' }
  });
  check('callback con state que no coincide -> error',
    (r.location || '').indexOf('gcal=error') !== -1, r.location);

  r = await callFunction('auth-callback.mjs', {
    env: { APP_PASSWORD: PASS }, method: 'GET',
    url: 'https://x/.netlify/functions/auth-callback?code=C&state=abc',
    headers: { cookie: 'gstate=abc' }
  });
  check('callback con state que coincide -> gcal=ok',
    (r.location || '').indexOf('gcal=ok') !== -1, r.location);
  check('  y limpia la cookie', /gstate=;/.test(r.res.headers.get('set-cookie') || ''), r.res.headers.get('set-cookie'));

  // ------------------------------------------------------------- zona horaria ---
  console.log('\n-- Calendar: hora y zona horaria --');
  const cap = {};
  r = await callFunction('calendar.mjs', {
    env: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' },
    store: withGoogle(), fetch: googleStub(cap),
    body: JSON.stringify({
      action: 'create',
      order: { name: 'Ana', date: '2026-09-20', time: '15:00', phone: '561-555-0000', price: '45' },
      timeZone: 'America/Puerto_Rico'
    })
  });
  check('create devuelve el id del evento', r.body.ok === true && r.body.id === 'ev1', JSON.stringify(r.body));
  check('la hora de pared se conserva (15:00), no se corre a UTC',
    cap.payload && cap.payload.start.dateTime === '2026-09-20T15:00:00', JSON.stringify(cap.payload && cap.payload.start));
  check('se le dice a Google la zona del dispositivo',
    cap.payload && cap.payload.start.timeZone === 'America/Puerto_Rico', JSON.stringify(cap.payload && cap.payload.start));
  check('el fin es una hora después',
    cap.payload && cap.payload.end.dateTime === '2026-09-20T16:00:00', JSON.stringify(cap.payload && cap.payload.end));

  const cap2 = {};
  await callFunction('calendar.mjs', {
    env: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' },
    store: withGoogle(), fetch: googleStub(cap2),
    body: JSON.stringify({ action: 'create', order: { name: 'X', date: '2026-09-20', time: '23:30' }, timeZone: 'America/Puerto_Rico' })
  });
  check('23:30 termina a las 00:30 del día siguiente',
    cap2.payload && cap2.payload.end.dateTime === '2026-09-21T00:30:00', JSON.stringify(cap2.payload && cap2.payload.end));

  r = await callFunction('calendar.mjs', {
    env: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' },
    store: withGoogle(), fetch: googleStub({}),
    body: JSON.stringify({ action: 'update', timeZone: 'America/Puerto_Rico' })
  });
  check('update sin eventId -> 400 claro (antes daba 404 silencioso de Google)',
    r.status === 400 && r.body.error === 'no_event_id', JSON.stringify(r.body));

  const storeRevoked = withGoogle();
  r = await callFunction('calendar.mjs', {
    env: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' },
    store: storeRevoked, fetch: googleStub({ tokenError: 'invalid_grant' }),
    body: JSON.stringify({ action: 'create', order: { name: 'A', date: '2026-09-20' } })
  });
  check('invalid_grant borra el token guardado (la app deja de decir "conectado")',
    !('oauth' in storeRevoked), JSON.stringify(storeRevoked));

  // -------------------------------------------------------------------- push ---
  console.log('\n-- push --');
  r = await callFunction('push.mjs', {
    env: {}, store: { 'push-subscriptions': [{ endpoint: 'E1', keys: { p256dh: 'VIEJA' } }] },
    body: JSON.stringify({ action: 'subscribe', subscription: { endpoint: 'E1', keys: { p256dh: 'NUEVA' } } })
  });
  check('re-suscribir el mismo endpoint ACTUALIZA las claves (rotación)',
    r.store['push-subscriptions'][0].keys.p256dh === 'NUEVA', JSON.stringify(r.store['push-subscriptions']));
  check('  y no duplica la suscripción', r.store['push-subscriptions'].length === 1, JSON.stringify(r.store['push-subscriptions']));

  const dead = (endpoint) => async (sub) => {
    if (sub.endpoint === endpoint) { const e = new Error('gone'); e.statusCode = 410; throw e; }
    return {};
  };
  r = await callFunction('push.mjs', {
    env: { VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q' },
    store: { 'push-subscriptions': [{ endpoint: 'VIVA' }, { endpoint: 'MUERTA' }] },
    webpush: { setVapidDetails() {}, sendNotification: dead('MUERTA') },
    body: JSON.stringify({ action: 'test' })
  });
  check('el envío borra las suscripciones caducadas (410)',
    r.store['push-subscriptions'].length === 1 && r.store['push-subscriptions'][0].endpoint === 'VIVA',
    JSON.stringify(r.store['push-subscriptions']));
  check('  e informa cuántas quitó', r.body.removed === 1, JSON.stringify(r.body));

  // ------------------------------------------------------- recordatorio diario ---
  console.log('\n-- recordatorio diario (scheduled-reminders) --');
  const utcDate = (off) => {
    const d = new Date();
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + off));
    return t.toISOString().slice(0, 10);
  };
  const remind = async (orders) => {
    const sent = [];
    const res = await callFunction('scheduled-reminders.mjs', {
      env: { VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q' },
      store: { orders, 'push-subscriptions': [{ endpoint: 'E' }] },
      webpush: { setVapidDetails() {}, sendNotification: async (s, p) => { sent.push(JSON.parse(p)); return {}; } },
      method: 'GET'
    });
    return { res: res.body, push: sent };
  };

  let out = await remind([{ id: '1', name: 'Ana', date: utcDate(0), done: false }]);
  check('pedido para hoy -> avisa', out.res.due === 1 && out.push.length === 1 && /Ana/.test(out.push[0].body), JSON.stringify(out));

  out = await remind([{ id: '2', name: 'Luis', date: utcDate(-3), done: false }]);
  check('pedido ATRASADO -> avisa (antes se excluía y nunca salía)',
    out.res.due === 1 && out.push.length === 1 && /atrasada/.test(out.push[0].body), JSON.stringify(out));

  out = await remind([{ id: '3', name: 'Eva', date: utcDate(5), done: false }]);
  check('pedido en 5 días -> no avisa', out.res.due === 0 && out.push.length === 0, JSON.stringify(out));

  out = await remind([{ id: '4', name: 'Sof', date: utcDate(-2), done: true }]);
  check('pedido atrasado pero ya entregado -> no avisa', out.res.due === 0 && out.push.length === 0, JSON.stringify(out));

  out = await remind([
    { id: '5', name: 'Leo', date: utcDate(-4), done: false },
    { id: '6', name: 'Mia', date: utcDate(1), done: false }
  ]);
  check('atrasado + próximo -> un solo aviso que menciona ambos',
    out.res.due === 2 && out.push.length === 1 && /1 por entregar pronto y 1 atrasado/.test(out.push[0].body),
    JSON.stringify(out));
}

module.exports = { name: 'Funciones de Netlify (auth, Calendar, push, recordatorios)', run };
if (require.main === module) runStandalone(module.exports);
