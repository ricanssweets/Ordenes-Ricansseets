import { getStore } from '@netlify/blobs';

// --- Puerta de acceso -------------------------------------------------------
// Si APP_PASSWORD está configurado en Netlify, las funciones que tocan datos
// exigen la cabecera X-App-Key. Sin esa variable siguen abiertas (como antes),
// pero /health lo reporta y la app lo avisa, para que no pase inadvertido.
// Esta misma comprobación está copiada en orders.mjs, calendar.mjs, push.mjs y
// auth.mjs: si cambias una, cambia las cinco.
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Endpoint de estado: le dice al frontend si el backend está vivo,
// si Google Calendar ya está conectado y la clave pública de push.
export default async (req) => {
  let googleConnected = false;
  try {
    const raw = await getStore('ricans-sweets').get('oauth');
    const oauth = raw ? JSON.parse(raw) : null;
    googleConnected = !!(oauth && oauth.refresh_token);
  } catch (e) {
    googleConnected = false;
  }

  const expected = process.env.APP_PASSWORD;
  const authRequired = !!expected;
  const authorized = !authRequired || sameSecret(req.headers.get('x-app-key') || '', expected);

  return Response.json({
    ok: true,
    googleConnected,
    authRequired,
    authorized,
    // La clave pública de push solo se entrega a quien ya está autorizado.
    pushPublicKey: authorized ? (process.env.VAPID_PUBLIC_KEY || '') : ''
  });
};
