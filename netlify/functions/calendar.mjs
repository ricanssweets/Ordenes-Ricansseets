import { getStore } from '@netlify/blobs';

const STORE = 'ricans-sweets';

// --- Puerta de acceso -------------------------------------------------------
// Si APP_PASSWORD está configurado en Netlify, las funciones que tocan datos
// exigen la cabecera X-App-Key. Sin esa variable siguen abiertas (como antes),
// pero /health lo reporta y la app lo avisa, para que no pase inadvertido.
// Esta misma comprobación está copiada en health.mjs, orders.mjs, push.mjs y
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
  if (!res.ok || !data.access_token) {
    // invalid_grant = el usuario revocó el acceso desde su cuenta de Google.
    // Se borra el token guardado para que /health lo reporte y la app deje de
    // decir "Calendario conectado" cuando ya no lo está.
    if (data && data.error === 'invalid_grant') {
      try { await getStore(STORE).delete('oauth'); } catch (e) {}
    }
    return null;
  }
  return data.access_token;
}

// Construye el evento a partir de la hora de pared que se escribió en la app.
// El servidor de Netlify corre en UTC, así que NO se puede usar su zona horaria:
// hay que recibir la del dispositivo (la manda el frontend) y calcular las
// cadenas de fecha/hora con aritmética UTC, independiente de la zona del server.
// Antes usaba la zona del servidor (UTC), así que un pedido de las 3:00 PM se
// creaba a las 3:00 PM UTC: las 11:00 AM en Puerto Rico.
function eventPayload(order, timeZone) {
  const date = String(order.date || '');
  const time = (order.time && /^\d{2}:\d{2}$/.test(order.time)) ? order.time : '09:00';
  const [Y, M, D] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const startMs = Date.UTC(Y, M - 1, D, h, m, 0, 0);
  if (!isFinite(startMs)) return null;

  const pad = (n) => String(n).padStart(2, '0');
  const wall = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
  };
  const tz = timeZone || 'UTC';

  let priceTxt = '';
  const n = Number(order.price);
  if (order.price !== '' && order.price != null && isFinite(n)) priceTxt = n.toFixed(2);

  return {
    summary: `Entrega: ${order.name} — Rican's Sweets by Fany`,
    description: `${order.info || ''}${order.phone ? '\nTel: ' + order.phone : ''}${priceTxt ? '\nPrecio: $' + priceTxt : ''}`,
    start: { dateTime: wall(startMs), timeZone: tz },
    end: { dateTime: wall(startMs + 60 * 60000), timeZone: tz },
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
  // Esta función actúa con el refresh token de Google guardado en el servidor:
  // sin clave, cualquiera podría crear o borrar eventos del calendario.
  if (!authorized(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const token = await getAccessToken();
  if (!token) {
    return Response.json({ ok: false, error: 'no_token' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const { action, order, eventId, timeZone } = body;

  let method;
  let path;
  if (action === 'create') {
    method = 'POST';
    path = '/calendars/primary/events';
  } else if (action === 'update') {
    method = 'PATCH';
    // Sin id, encodeURIComponent(undefined) producía la cadena "undefined" y
    // la petición fallaba en silencio con un 404 de Google.
    const id = eventId || (order && order.gcalEventId);
    if (!id) return Response.json({ ok: false, error: 'no_event_id' }, { status: 400 });
    path = '/calendars/primary/events/' + encodeURIComponent(id);
  } else if (action === 'delete') {
    method = 'DELETE';
    if (!eventId) return Response.json({ ok: false, error: 'no_event_id' }, { status: 400 });
    path = '/calendars/primary/events/' + encodeURIComponent(eventId);
  } else {
    return Response.json({ ok: false, error: 'bad_action' }, { status: 400 });
  }

  let payload = null;
  if (method !== 'DELETE') {
    payload = eventPayload(order || {}, timeZone);
    if (!payload) return Response.json({ ok: false, error: 'bad_order' }, { status: 400 });
  }

  const res = await fetch('https://www.googleapis.com/calendar/v3' + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: method === 'DELETE' ? undefined : JSON.stringify(payload)
  });

  if (res.status === 204) return Response.json({ ok: true });
  const data = await res.json().catch(() => ({}));
  return Response.json({ ok: res.ok, id: data && data.id });
};
