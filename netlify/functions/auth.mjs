import { randomUUID } from 'node:crypto';

// --- Puerta de acceso -------------------------------------------------------
// Si APP_PASSWORD está configurado en Netlify, las funciones que tocan datos
// exigen una clave. Aquí no puede ir en cabecera (el navegador navega a esta
// URL, no hace fetch), así que viaja en ?key=.
// Esta misma comprobación está copiada en health.mjs, orders.mjs, calendar.mjs
// y push.mjs: si cambias una, cambia las cinco.
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Inicia el flujo OAuth de Google (authorization code flow).
// Redirige al usuario a la pantalla de consentimiento de Google.
export default async (req, context) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response('GOOGLE_CLIENT_ID no está configurado en Netlify.', { status: 500 });
  }

  const url = new URL(req.url);

  // Sin esta comprobación, cualquiera que encontrara la URL podía autorizar SU
  // propia cuenta de Google: el callback guarda el refresh_token sin mirar
  // quién lo pidió, así que se quedaba con la integración del calendario.
  const expected = process.env.APP_PASSWORD;
  if (expected && !sameSecret(url.searchParams.get('key') || '', expected)) {
    return new Response('Clave incorrecta. Abre la app y vuelve a conectar el calendario.', { status: 401 });
  }

  const base = (context.site && context.site.url) || url.origin;
  const redirectUri = base + '/.netlify/functions/auth-callback';
  const scope = 'https://www.googleapis.com/auth/calendar.events';

  // state aleatorio + cookie HttpOnly: el callback solo acepta la vuelta que
  // empezó en este mismo navegador. Antes el state era la cadena fija 'ricans'
  // y no se verificaba nunca.
  const state = randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    state
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
      'Set-Cookie': 'gstate=' + state + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600'
    }
  });
};
