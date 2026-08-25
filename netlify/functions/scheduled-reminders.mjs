import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

const STORE = 'ricans-sweets';

function daysUntil(dateStr) {
  if (!dateStr) return 0;
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return 0;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return 0;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = Date.UTC(y, m - 1, d);
  if (isNaN(target)) return 0;
  return Math.round((target - today) / 86400000);
}

// Se ejecuta una vez al día. Envía push si hay pedidos por entregar en 2 días o menos.
// 0 13 * * * = 13:00 UTC ≈ 9 AM (hora del este, EE.UU., en invierno).
export const config = { schedule: '0 13 * * *' };

export default async () => {
  const s = getStore(STORE);

  const rawOrders = await s.get('orders');
  let orders = [];
  try { orders = rawOrders ? JSON.parse(rawOrders) : []; } catch (e) { orders = []; }

  const rawSubs = await s.get('push-subscriptions');
  let subs = [];
  try { subs = rawSubs ? JSON.parse(rawSubs) : []; } catch (e) { subs = []; }

  const due = orders.filter((o) => !o.done && daysUntil(o.date) <= 2 && daysUntil(o.date) >= 0);
  if (due.length === 0 || subs.length === 0) {
    return Response.json({ ok: true, due: due.length, sent: 0 });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return Response.json({ ok: true, due: due.length, sent: 0, error: 'no_vapid' });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:ricans@example.com',
    publicKey,
    privateKey
  );

  const payload = JSON.stringify({
    title: "Rican's Sweets — Pedidos próximos",
    body: due.length === 1
      ? `${due[0].name}: entrega pronto`
      : `${due.length} pedidos por entregar en 2 días o menos`,
    url: '/'
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (e) {
      // Suscripción inválida/expirada: se ignora.
    }
  }

  return Response.json({ ok: true, due: due.length, sent });
};
