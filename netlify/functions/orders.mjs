import { getStore } from '@netlify/blobs';

const STORE = 'ricans-sweets';
const KEY = 'orders';

// Almacén central de pedidos (para sincronización entre dispositivos y para
// que la función programada pueda leerlos y enviar recordatorios).
export default async (req) => {
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
