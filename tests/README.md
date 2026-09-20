# Pruebas

Esto no forma parte de la app. Son comprobaciones automáticas para asegurarse de
que un cambio no ha roto nada, y **no se ejecutan en el build de Netlify** (el
build solo hace `npm install`). Se corren a mano cuando se toca el código.

## Cómo se corren

Con Node instalado, desde la carpeta del proyecto:

```
npm test
```

También se puede correr una sola suite:

```
node tests/functions.test.js
node tests/app.test.js
node tests/sw.test.js
node tests/config.test.js
```

Sale `PASS` o `FALLA` por cada comprobación, y termina con el total. Si hay algún
`FALLA`, el comando termina con error.

## Qué comprueba cada una

| Archivo | Qué cubre |
|---|---|
| `functions.test.js` | Las 7 funciones de Netlify, ejecutadas de verdad en un sandbox con equivalentes de Blobs, web-push y `fetch`. Cubre la puerta de acceso (`APP_PASSWORD`), el CSRF del OAuth, la zona horaria de los eventos, que un acceso revocado borre el token, la rotación de claves de push y el recordatorio diario. |
| `app.test.js` | El JS real de `index.html` contra un DOM simulado: arranque, dibujado de tarjetas, escapado de HTML, fechas inválidas, la fusión de pedidos entre dispositivos, **deshacer al borrar** y **las sugerencias de clientes**. |
| `sw.test.js` | El service worker. Sobre todo que **nunca cachee las llamadas a la API** — ese fue el bug que borraba pedidos. |
| `config.test.js` | `netlify.toml`, `manifest.json`, y coherencia de `index.html`: que todos los elementos que busca el script existan, que la clave viaje en todas las llamadas, que la puerta de acceso siga en las 5 funciones y que no haya secretos escritos en el repo. |

## Por qué existe esto

En agosto de 2026 el service worker cacheaba las respuestas de la API sin que
nadie lo notara. La app leía una lista de pedidos vieja de la caché y la volvía a
subir a la nube, **borrando los pedidos nuevos**. Estuvo así meses.

Ese tipo de fallo no se ve mirando la pantalla: hace falta ejecutar el código y
comprobar el comportamiento. De ahí estas pruebas.
