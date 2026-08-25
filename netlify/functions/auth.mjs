// Inicia el flujo OAuth de Google (authorization code flow).
// Redirige al usuario a la pantalla de consentimiento de Google.
export default async (req, context) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response('GOOGLE_CLIENT_ID no está configurado en Netlify.', { status: 500 });
  }

  const base = (context.site && context.site.url) || new URL(req.url).origin;
  const redirectUri = base + '/.netlify/functions/auth-callback';
  const scope = 'https://www.googleapis.com/auth/calendar.events';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    state: 'ricans'
  });

  return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), 302);
};
