import { getStore } from '@netlify/blobs';

// Vuelve a la app limpiando la cookie de state.
function backToApp(base, query) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: base + '/' + query,
      'Set-Cookie': 'gstate=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    }
  });
}

// Callback de OAuth: Google redirige aquí con ?code=... o ?error=...
// Intercambia el código por tokens y guarda el refresh_token (nunca llega al navegador).
export default async (req, context) => {
  const url = new URL(req.url);
  const base = (context.site && context.site.url) || url.origin;

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  // El state tiene que coincidir con la cookie que dejó auth.mjs en ESTE
  // navegador. Sin esta comprobación, un tercero podía completar el flujo a
  // nombre de otro (CSRF de OAuth).
  const cookies = req.headers.get('cookie') || '';
  const match = cookies.match(/(?:^|;\s*)gstate=([^;]+)/);
  const cookieState = match ? match[1] : '';

  if (error || !code || !state || !cookieState || state !== cookieState) {
    return backToApp(base, '?gcal=error');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = base + '/.netlify/functions/auth-callback';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.refresh_token) {
      return backToApp(base, '?gcal=error');
    }

    await getStore('ricans-sweets').set('oauth', JSON.stringify({
      refresh_token: tokens.refresh_token,
      updated_at: Date.now()
    }));

    return backToApp(base, '?gcal=ok');
  } catch (e) {
    return backToApp(base, '?gcal=error');
  }
};
