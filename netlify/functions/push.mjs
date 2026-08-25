import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

const STORE = 'ricans-sweets';
const KEY = 'push-subscriptions';

// Guarda/quita suscripciones push de los dispositivos, y permite enviar una
// notificación de prueba al instante (acción "test").
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

  if (body.action === 'test') {
    if (subs.length === 0) return Response.json({ ok: true, sent: 0 });
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return Response.json({ ok: true, sent: 0, error: 'no_vapid' });
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:ricans@example.com',
      publicKey,
      privateKey
    );
    const payload = JSON.stringify({
      title: "Rican's Sweets",
      body: 'Esta es una notificación de prueba ✓',
      url: '/'
    });
    let sent = 0;
    for (const sub of subs) {
      try { await webpush.sendNotification(sub, payload); sent++; } catch (e) { /* suscripción inválida */ }
    }
    return Response.json({ ok: true, sent });
  }

  return Response.json({ ok: false, error: 'bad_action' }, { status: 400 });
};
