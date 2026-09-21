# Guía de configuración — Rican's Sweets (Netlify + OAuth + Push)

Esta guía te lleva de cero a tener la app funcionando con:

1. **OAuth seguro de Google Calendar** (el secreto queda en el servidor, nunca en el navegador, y ya no reconectas cada hora).
2. **Sincronización entre dispositivos** (los pedidos se guardan en la nube).
3. **Notificaciones push** cuando un pedido está por entregar (aunque la app esté cerrada).

Todo lo que aparece aquí es **gratis** en sus planes gratuitos.

---

## ⚠️ Lo primero: hay DOS direcciones, y no son lo mismo

| | GitHub Pages | **Netlify** |
|---|---|---|
| Dirección | `ricanssweets.github.io/Ordenes-Ricansseets` | `ordenes-ricansseets.netlify.app` |
| Pedidos | Solo en ese dispositivo y navegador | **Sincronizados entre dispositivos** |
| Calendario | Hay que reconectar casi cada hora | Conectado de forma permanente |
| Aviso con la app cerrada | No | **Sí** |
| Clave | No hace falta | Sí |

**Las dos NO comparten datos.** Son dos apps separadas, con dos listas de pedidos distintas: lo que anotas en una **no** aparece en la otra. Ni sincronizando, ni recargando.

**Usa siempre la de Netlify** — es la única donde funciona todo. Instala esa como app en los teléfonos.

Si algún día tienes pedidos en la de GitHub y los quieres pasar: en esa toca **Respaldo** (te baja un archivo), y en la de Netlify toca **Importar** con ese archivo. Se mezclan sin duplicarse.

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

### La trampa que cuesta una noche entera: DOS proyectos de Google

Es facilísimo acabar con **dos proyectos de Google Cloud** sin darse cuenta, y estar configurando uno mientras la app usa el otro. Los síntomas son desesperantes: rellenas usuarios de prueba, dominios y marca, y la app sigue bloqueando con *"Error 403: access_denied"* pase lo que pase.

**Cómo saber cuál es el bueno:** el Client ID empieza por el **número del proyecto**.

```
404686483801-gl3laatvj5485kmkgaid7ri29nd0ob2s.apps.googleusercontent.com
└──────────┘
   este número es el proyecto que hay que configurar
```

Para comprobarlo: en la consola, **Google Auth Platform → Clientes**. Si el cliente que aparece ahí **no** empieza por el mismo número que el Client ID que tienes en Netlify, estás en el proyecto equivocado. Cambia de proyecto con el **selector de arriba**.

> Ojo también con la barra de direcciones: si la URL lleva `?project=loquesea`, está forzando ese proyecto. Si no es el tuyo, verás *"Necesitas acceso adicional"*.

### El dominio autorizado va SIN `https://`

En **Información de la marca → Dominios autorizados** se escribe el dominio pelado:

```
ordenes-ricansseets.netlify.app            ✅ correcto
https://ordenes-ricansseets.netlify.app    ❌ "No debe especificar el esquema"
```

Y esto importa más de lo que parece: **si esa página tiene un error, Google no guarda la marca entera.** Y con la marca a medias, el botón de publicar queda bloqueado **y la pantalla de consentimiento no funciona bien, ni siquiera para los usuarios de prueba que ya añadiste**.

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
| `APP_PASSWORD` | una clave larga que inventes tú (ver abajo) | Functions |

3. **Importante:** después de guardar, Netlify te pedirá **"Trigger deploy"** (redeploy). Hazlo para que las variables se apliquen.

### Protege el backend con una clave (`APP_PASSWORD`)

**Sin esta variable, cualquiera que descubra la URL de tu sitio puede leer los nombres y teléfonos de tus clientes.** Las funciones de Netlify son públicas por diseño: no hay login.

Cómo se comporta:

- **Si `APP_PASSWORD` no está puesta:** el backend queda abierto (igual que antes) y la app te muestra un aviso de advertencia arriba, para que no pase inadvertido.
- **Si está puesta:** la app te pide la clave una vez por dispositivo (botón **Clave**) y la guarda en ese navegador. Sin la clave correcta, los pedidos, el calendario y las notificaciones no responden.
- La clave **no** está escrita en la página: la escribes tú, así que nadie puede sacarla mirando el código de la app.

Recomendación: usa algo largo y difícil de adivinar (por ejemplo cuatro palabras juntas), porque no hay límite de intentos.

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
3. Cada día (~9 AM en Puerto Rico), el sistema revisa si hay pedidos por entregar en 2 días o menos —o ya atrasados— y te manda un **push** aunque no tengas la app abierta.

Para probar sin esperar: crea un pedido con fecha de entrega de hoy o mañana. El push se enviará en la próxima ejecución diaria.

---

## Paso 7 — Publicar la app de Google (quita el reconectar cada 7 días)

Mientras la app de Google esté en estado **"Prueba"**, Google hace que el permiso del calendario **caduque cada 7 días**. La app te avisará con *"Se perdió la conexión con Google Calendar"* y tendrás que reconectar. Es una regla de Google, no un fallo de la app.

Tampoco pierdes ningún pedido cuando pasa: solo se pausa el calendario.

Para que no vuelva a ocurrir hay que **publicar** la app. Es papeleo, pero se hace una sola vez:

1. Entra a la consola de Google Cloud y **selecciona el proyecto correcto** (el del número que empieza tu Client ID — ver la trampa del Paso 2).
2. Ve a **Google Auth Platform → Público**. Ahí está el estado y el botón **"Publicar app"**.
3. Si el botón está **gris**, pasa el ratón por encima: Google te dice exactamente qué falta. Casi siempre son cuatro cosas, que se rellenan en **Información de la marca**:
   - **Nombre de la aplicación** — no vale dejarlo con la URL por defecto
   - **Correo de asistencia al usuario**
   - **Página principal**: `https://ordenes-ricansseets.netlify.app/`
   - **Política de privacidad**: `https://ordenes-ricansseets.netlify.app/privacidad.html`
4. Guarda (que no quede ningún aviso rojo). Vuelve a **Público**: el botón **"Publicar app"** ya estará activo. Púlsalo.
5. Cuando diga **"En producción"**, **reconecta el calendario una vez** en la app. El permiso que tenías se emitió en modo prueba, así que ese sí caduca; el nuevo ya no.

### Al reconectar sale un aviso que asusta

> *"Google no ha verificado esta app"*

Es normal: **publicar no es lo mismo que verificar**, y verificar es un proceso pensado para apps que usa gente ajena. La tuya la usas tú. Se pasa así:

- Busca **abajo**, en letra pequeña, el enlace **"Configuración avanzada"** (es fácil no verlo).
- Al tocarlo aparece **"Ir a ordenes-ricansseets.netlify.app (no seguro)"**. Tócalo.

Y ya. Solo sale la vez que autorizas.

---

## Instalar la app como aplicación en el teléfono

1. Abre **Chrome** — el navegador de verdad, **no** desde Messenger, WhatsApp ni Instagram. Esos navegadores de dentro de las apps **no pueden instalar apps**.
2. Ve a `ordenes-ricansseets.netlify.app` y deja que cargue del todo.
3. Toca **⋮** y elige **"Instalar"**.

**Cuidado con esto**, porque son dos opciones parecidas y **no hacen lo mismo**:

| Opción del menú | Qué hace |
|---|---|
| **Instalar** | Instala la app de verdad. Abre a pantalla completa, sin barra de direcciones. ✅ |
| **Crear acceso directo** | Crea un atajo a la web. Le queda un **cuadradito de Chrome** en la esquina del icono. ❌ |

Si el icono tiene el cuadradito, es un atajo. **No se convierte solo** cuando la web mejora: hay que borrar el icono y volver a añadirlo, esta vez con "Instalar".

La **clave** se escribe **una vez por dispositivo** y se queda guardada en ese navegador. Solo la volverías a necesitar si cambias de teléfono o navegador, o si borras los datos de navegación de Chrome.

---

## Solución de problemas

- **"Conectar" no hace nada / error**: revisa que el URI de redireccionamiento en Google Cloud sea EXACTO (incluye `/.netlify/functions/auth-callback` y usa HTTPS).
- **El calendario no se actualiza**: verifica `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` y que hiciste redeploy tras guardarlas.
- **No llegan push**: revisa `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (deben ser del MISMO par), y que hayas aceptado notificaciones en el navegador.
- **Ver logs**: en Netlify → tu sitio → **Logs** → **Functions**.
- **Google da "Error 403: access_denied"**: casi siempre es que estás configurando **un proyecto de Google distinto** al que usa la app. Compara el número del Client ID de Netlify con el del proyecto (ver la trampa del Paso 2).
- **"Publicar app" sale gris**: falta completar **Información de la marca**. Pasa el ratón por encima del botón y Google te dice qué falta.
- **El calendario se desconecta cada semana**: la app de Google sigue en modo "Prueba". Publícala (Paso 7).
- **Al reconectar no hay botón "Continuar"**: es el aviso de app no verificada. Busca **"Configuración avanzada"** abajo y luego *"Ir a ... (no seguro)"*.
- **El icono del teléfono tiene un cuadradito de Chrome**: se añadió como acceso directo. Bórralo y añádelo con **"Instalar"**.
- **La app pide la clave y no sincroniza**: toca **Clave** y escribe el valor de `APP_PASSWORD`. Si sigue igual, revisa que la variable exista en Netlify **y** que hayas hecho redeploy después de guardarla.
- **Aparece el aviso de que el backend no tiene clave**: es que `APP_PASSWORD` no está configurada. Mientras no la pongas, los pedidos de la nube los puede leer cualquiera que sepa la URL.

---

## Volver al modo local (sin backend)

No tienes que hacer nada: la app detecta si hay backend y, si no, usa `localStorage` como siempre. Es lo que ocurre en la dirección de GitHub Pages.

Pero recuerda lo del principio de esta guía: **las dos direcciones no comparten datos**. Usa siempre la de Netlify.

---

## Comprobar que no se ha roto nada

El proyecto trae pruebas automáticas. Con Node instalado, desde la carpeta del proyecto:

```
npm test
```

Ejecutan las funciones del backend en un entorno simulado, la app entera contra un navegador de mentira, el service worker y la coherencia de la configuración. Son **154 comprobaciones**, y cada función nueva tiene las suyas.

**No se ejecutan al desplegar**: solo cuando las lanzas tú a mano. Están ahí para que un cambio no rompa algo sin que se note — en su día se coló un fallo que borraba pedidos y estuvo meses sin detectarse.

