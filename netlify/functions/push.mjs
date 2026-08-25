import { getStore } from '@netlify/blobs';

const STORE = 'ricans-sweets';
const KEY = 'push-subscriptions';

// Guarda/quita suscripciones push de los dispositivos.
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body = {};
  try { body = await req.json(); } catch (e) { body = {}; }

  const s = getStore(STORE);
  const raw = await s.get(KEY);
  let subs = [];
  try { subs = raw ? JSON.parse(raw) : []; } catch (e) { subs = []; }

  if (body.action === 'subscribe') {
    const sub = body.subscription;
    if (!sub || !sub.endpoint) return Response.json({ ok: false }, { status: 400 });
    const exists = subs.some((x) => x.endpoint === sub.endpoint);
    if (!exists) subs.push(sub);
    await s.set(KEY, JSON.stringify(subs));
    return Response.json({ ok: true, count: subs.length });
  }

  if (body.action === 'unsubscribe') {
    subs = subs.filter((x) => x.endpoint !== body.endpoint);
    await s.set(KEY, JSON.stringify(subs));
    return Response.json({ ok: true, count: subs.length });
  }

  return Response.json({ ok: false, error: 'bad_action' }, { status: 400 });
};
