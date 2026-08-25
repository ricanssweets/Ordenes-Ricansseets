import { getStore } from '@netlify/blobs';

// Callback de OAuth: Google redirige aquí con ?code=... o ?error=...
// Intercambia el código por tokens y guarda el refresh_token (nunca llega al navegador).
export default async (req, context) => {
  const url = new URL(req.url);
  const base = (context.site && context.site.url) || url.origin;

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error || !code) {
    return Response.redirect(base + '/?gcal=error', 302);
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
      return Response.redirect(base + '/?gcal=error', 302);
    }

    await getStore('ricans-sweets').set('oauth', JSON.stringify({
      refresh_token: tokens.refresh_token,
      updated_at: Date.now()
    }));

    return Response.redirect(base + '/?gcal=ok', 302);
  } catch (e) {
    return Response.redirect(base + '/?gcal=error', 302);
  }
};
