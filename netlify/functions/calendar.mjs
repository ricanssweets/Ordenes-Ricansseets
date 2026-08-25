import { getStore } from '@netlify/blobs';

const STORE = 'ricans-sweets';

async function getAccessToken() {
  const raw = await getStore(STORE).get('oauth');
  const oauth = raw ? JSON.parse(raw) : null;
  if (!oauth || !oauth.refresh_token) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: oauth.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  return data.access_token || null;
}

function eventPayload(order) {
  const date = order.date;
  const time = (order.time && /^\d{2}:\d{2}$/.test(order.time)) ? order.time : '09:00';
  const [h, m] = time.split(':').map(Number);
  const start = new Date(date + 'T00:00:00');
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + 60 * 60000);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pad = (n) => String(n).padStart(2, '0');
  const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  let priceTxt = '';
  const n = Number(order.price);
  if (order.price !== '' && order.price != null && isFinite(n)) priceTxt = n.toFixed(2);

  return {
    summary: `Entrega: ${order.name} — Rican's Sweets by Fany`,
    description: `${order.info || ''}${order.phone ? '\nTel: ' + order.phone : ''}${priceTxt ? '\nPrecio: $' + priceTxt : ''}`,
    start: { dateTime: toLocal(start), timeZone: tz },
    end: { dateTime: toLocal(end), timeZone: tz },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 2880 },
        { method: 'email', minutes: 2880 },
        { method: 'popup', minutes: 60 }
      ]
    }
  };
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const token = await getAccessToken();
  if (!token) {
    return Response.json({ ok: false, error: 'no_token' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const { action, order, eventId } = body;

  let method;
  let path;
  if (action === 'create') {
    method = 'POST';
    path = '/calendars/primary/events';
  } else if (action === 'update') {
    method = 'PATCH';
    path = '/calendars/primary/events/' + encodeURIComponent(eventId || (order && order.gcalEventId));
  } else if (action === 'delete') {
    method = 'DELETE';
    path = '/calendars/primary/events/' + encodeURIComponent(eventId);
  } else {
    return Response.json({ ok: false, error: 'bad_action' }, { status: 400 });
  }

  const res = await fetch('https://www.googleapis.com/calendar/v3' + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: method === 'DELETE' ? undefined : JSON.stringify(eventPayload(order))
  });

  if (res.status === 204) return Response.json({ ok: true });
  const data = await res.json().catch(() => ({}));
  return Response.json({ ok: res.ok, id: data && data.id });
};
