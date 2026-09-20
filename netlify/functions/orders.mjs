import { getStore } from '@netlify/blobs';

const STORE = 'ricans-sweets';
const KEY = 'orders';

// --- Puerta de acceso -------------------------------------------------------
// Si APP_PASSWORD está configurado en Netlify, las funciones que tocan datos
// exigen la cabecera X-App-Key. Sin esa variable siguen abiertas (como antes),
// pero /health lo reporta y la app lo avisa, para que no pase inadvertido.
// Esta misma comprobación está copiada en health.mjs, calendar.mjs, push.mjs y
// auth.mjs: si cambias una, cambia las cinco.
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function authorized(req) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  return sameSecret(req.headers.get('x-app-key') || '', expected);
}

// Almacén central de pedidos (para sincronización entre dispositivos y para
// que la función programada pueda leerlos y enviar recordatorios).
export default async (req) => {
  // Aquí viven los nombres y teléfonos de los clientes: sin clave no se sirve
  // nada, ni lectura ni escritura.
  if (!authorized(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const s = getStore(STORE);

  if (req.method === 'GET') {
    const raw = await s.get(KEY);
    let orders = [];
    try { orders = raw ? JSON.parse(raw) : []; } catch (e) { orders = []; }
    return Response.json({ orders });
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch (e) { body = {}; }
    const orders = Array.isArray(body.orders) ? body.orders : [];
    await s.set(KEY, JSON.stringify(orders));
    return Response.json({ ok: true, count: orders.length });
  }

  return new Response('Method not allowed', { status: 405 });
};
