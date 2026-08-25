import { getStore } from '@netlify/blobs';

// Endpoint de estado: le dice al frontend si el backend está vivo,
// si Google Calendar ya está conectado y la clave pública de push.
export default async () => {
  let googleConnected = false;
  try {
    const raw = await getStore('ricans-sweets').get('oauth');
    const oauth = raw ? JSON.parse(raw) : null;
    googleConnected = !!(oauth && oauth.refresh_token);
  } catch (e) {
    googleConnected = false;
  }

  return Response.json({
    ok: true,
    googleConnected,
    pushPublicKey: process.env.VAPID_PUBLIC_KEY || ''
  });
};
