# Guía de configuración — Rican's Sweets (Netlify + OAuth + Push)

Esta guía te lleva de cero a tener la app funcionando con:

1. **OAuth seguro de Google Calendar** (el secreto queda en el servidor, nunca en el navegador, y ya no reconectas cada hora).
2. **Sincronización entre dispositivos** (los pedidos se guardan en la nube).
3. **Notificaciones push** cuando un pedido está por entregar (aunque la app esté cerrada).

Todo lo que aparece aquí es **gratis** en sus planes gratuitos.

---

## Resumen rápido de servicios (3)

| Servicio | Para qué | Necesitas |
|---|---|---|
| **Netlify** | Hospedar la app + funciones (backend) | Cuenta gratis + conectar el repo |
| **Google Cloud** | OAuth de Calendar | Client ID + Client Secret |
| **web-push** (VAPID) | Claves para push | 2 claves generadas con un comando |

> La base de datos **no** es un servicio aparte: usamos el almacenamiento de Netlify (Blobs), ya incluido.

---

## Paso 1 — Subir la app a Netlify

1. Entra a https://app.netlify.com y crea una cuenta (puedes usar tu cuenta de GitHub).
2. Clic en **"Add new site" → "Import an existing project"**.
3. Conecta GitHub y elige el repositorio **`ricanssweets/Ordenes-Ricansseets`**.
4. Netlify detecta la config automáticamente (`netlify.toml`). Clic en **Deploy**.
5. Cuando termine, tendrás una URL tipo `https://tunombre.netlify.app`. **Anótala** (la usas en el Paso 2).

> Tu app en GitHub Pages **sigue funcionando igual** (modo local). La versión de Netlify es la que tiene backend.

---

## Paso 2 — Crear las credenciales de Google (OAuth)

1. Entra a https://console.cloud.google.com/
2. Arriba, crea un **proyecto** (ej. "Ricans Sweets").
3. En el menú → **APIs y servicios → Biblioteca** → busca **"Google Calendar API"** → **Habilitar**.
4. Menú → **APIs y servicios → Pantalla de consentimiento OAuth**:
   - Tipo: **Externo** → Crear.
   - Nombre de la app: `Rican's Sweets`.
   - Correo de soporte: tu correo.
   - Guarda (lo demás puedes dejarlo vacío).
5. En esa misma pantalla, ve a **"Público" / Test users** (Usuarios de prueba) y **agrega tu propio correo**. Esto te permite usar la app sin que Google la "verifique" (suficiente para uso personal).
6. Menú → **APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth**:
   - Tipo de aplicación: **Aplicación web**.
   - **URI de redireccionamiento autorizados**: pega exactamente:
     ```
     https://TU-SITIO.netlify.app/.netlify/functions/auth-callback
     ```
     (reemplaza `TU-SITIO` por tu URL real de Netlify del Paso 1).
   - Clic **Crear**.
7. Copia el **Client ID** y el **Client Secret** (te harán falta en el Paso 3).

---

## Paso 3 — Poner las variables de entorno en Netlify

1. En Netlify, entra a tu sitio → **Site configuration → Environment variables**.
2. Agrega estas variables (botón **Add a variable**):

| Nombre | Valor | Alcance |
|---|---|---|
| `GOOGLE_CLIENT_ID` | tu Client ID (termina en `.apps.googleusercontent.com`) | Functions |
| `GOOGLE_CLIENT_SECRET` | tu Client Secret | Functions |
| `VAPID_PUBLIC_KEY` | (la generas en el Paso 4) | Functions |
| `VAPID_PRIVATE_KEY` | (la generas en el Paso 4) | Functions |
| `VAPID_SUBJECT` | `mailto:TU_CORREO@gmail.com` | Functions |

3. **Importante:** después de guardar, Netlify te pedirá **"Trigger deploy"** (redeploy). Hazlo para que las variables se apliquen.

---

## Paso 4 — Generar las claves de push (VAPID)

En tu computadora, con Node instalado, abre una terminal (cmd o PowerShell) y ejecuta:

```bash
npx web-push generate-vapid-keys
```

Te devuelve algo como:

```
Public Key:  BJthRQ...  (larga)
Private Key: xxxxx...   (larga)
```

- Copia la **Public Key** en la variable `VAPID_PUBLIC_KEY`.
- Copia la **Private Key** en `VAPID_PRIVATE_KEY`.
- Guarda y haz redeploy de nuevo.

---

## Paso 5 — Conectar Google Calendar en la app

1. Abre tu app en **la URL de Netlify** (no la de GitHub Pages).
2. Arriba verás la barra "📅 Conecta tu Google Calendar" → clic en **Conectar**.
3. Te lleva a Google para autorizar. Acepta.
4. Vuelve a la app y verás "📅 Calendario conectado".

Desde ahora, al guardar un pedido, el evento se crea/actualiza/borra en tu calendario **usando el backend** (el secreto nunca está en tu navegador).

---

## Paso 6 — Activar las notificaciones push

1. En la app (URL de Netlify), toca **"Activar"** en el aviso de notificaciones (o acepta cuando el navegador lo pida).
2. La app se suscribe automáticamente a push.
3. Cada día (~9 AM hora del este), el sistema revisa si hay pedidos por entregar en 2 días o menos y te manda un **push** aunque no tengas la app abierta.

Para probar sin esperar: crea un pedido con fecha de entrega de hoy o mañana. El push se enviará en la próxima ejecución diaria.

---

## Solución de problemas

- **"Conectar" no hace nada / error**: revisa que el URI de redireccionamiento en Google Cloud sea EXACTO (incluye `/.netlify/functions/auth-callback` y usa HTTPS).
- **El calendario no se actualiza**: verifica `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` y que hiciste redeploy tras guardarlas.
- **No llegan push**: revisa `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (deben ser del MISMO par), y que hayas aceptado notificaciones en el navegador.
- **Ver logs**: en Netlify → tu sitio → **Logs** → **Functions**.

---

## Volver al modo local (sin backend)

No tienes que hacer nada: la app detecta si hay backend y, si no, usa `localStorage` como siempre (por ejemplo en la URL de GitHub Pages). Puedes seguir usando cualquiera de las dos URLs.
