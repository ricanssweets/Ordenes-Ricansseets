'use strict';
// Comprobaciones estáticas: configuración, coherencia del HTML y que la puerta de
// acceso siga puesta. No ejecutan la app, pero cazan regresiones tontas.
const fs = require('fs');
const path = require('path');
const { REPO, FUNCTIONS_DIR, read, makeReporter, runStandalone } = require('./helpers');

const glob = (pattern, p) =>
  new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(p);

async function run(check) {
  const toml = read('netlify.toml');
  const html = read('index.html');
  const script = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i)[1];

  // ------------------------------------------------------------- netlify.toml ---
  console.log('\n-- netlify.toml --');
  check('oculta el código de las funciones (/netlify/*)',
    glob('/netlify/*', '/netlify/functions/orders.mjs'));
  check('pero NO alcanza la API (/.netlify/functions/*)',
    !glob('/netlify/*', '/.netlify/functions/orders'), 'rompería toda la app');
  check('  ni el OAuth', !glob('/netlify/*', '/.netlify/functions/auth'));
  check('  ni la app', !glob('/netlify/*', '/index.html'));
  check('  ni el service worker', !glob('/netlify/*', '/sw.js'));
  check('el destino de las redirecciones existe (404.html)', fs.existsSync(path.join(REPO, '404.html')));
  check('oculta también la carpeta de pruebas',
    glob('/tests/*', '/tests/run.js') && !!toml.match(/from\s*=\s*"\/tests\/\*"/));

  ['X-Content-Type-Options', 'Referrer-Policy']
    .forEach((h) => check('define la cabecera ' + h, toml.indexOf(h) !== -1));
  // Estas dos se quitaron a proposito: eran la unica diferencia con el sitio de
  // GitHub Pages, que si se instala como app en Android.
  // Se buscan las asignaciones reales, no las menciones en los comentarios.
  check('NO se ponen X-Frame-Options ni Content-Security-Policy (rompian la instalacion)',
    !/X-Frame-Options\s*=/.test(toml) && !/Content-Security-Policy\s*=/.test(toml),
    'siguen puestas');
  check('sigue publicando la raíz', /publish\s*=\s*"\."/.test(toml));
  check('sigue apuntando a netlify/functions', /directory\s*=\s*"netlify\/functions"/.test(toml));

  // -------------------------------------------------------------- manifest.json ---
  console.log('\n-- manifest.json --');
  let mf = null;
  try { mf = JSON.parse(read('manifest.json')); } catch (e) { /* abajo se reporta */ }
  check('es JSON válido', mf !== null);
  if (mf) {
    const validos = ['any', 'maskable', 'monochrome'];
    const malos = [].concat(...mf.icons.map((i) => String(i.purpose || 'any').split(' ')))
      .filter((p) => validos.indexOf(p) === -1);
    check('los "purpose" de los iconos son válidos', malos.length === 0, malos.join(', '));
    // Chrome exige un icono de 192 y otro de 512. El de 180 es solo para el
    // enlace apple-touch-icon del HTML, así que no va en el manifest.
    check('están los dos iconos que Chrome exige (192 y 512)',
      mf.icons.length === 2 &&
      mf.icons.some((i) => i.sizes === '192x192') &&
      mf.icons.some((i) => i.sizes === '512x512'),
      JSON.stringify(mf.icons.map((i) => i.sizes)));
    check('cada icono declarado existe en el repo',
      mf.icons.every((i) => fs.existsSync(path.join(REPO, i.src))),
      mf.icons.map((i) => i.src).filter((s) => !fs.existsSync(path.join(REPO, s))).join(', '));
    // Comprobado con Chrome de verdad: con los iconos en JPEG, su comprobacion
    // interna devuelve "manifest-missing-suitable-icon" y la app DEJA DE SER
    // INSTALABLE. Por eso los del manifest tienen que seguir siendo PNG.
    check('los iconos del manifest son PNG (Chrome rechaza JPEG y no se puede instalar)',
      mf.icons.every((i) => i.type === 'image/png' && /\.png$/.test(i.src)),
      JSON.stringify(mf.icons.map((i) => i.src + ' ' + i.type)));
  }

  // ------------------------------------------------------------------ index.html ---
  console.log('\n-- coherencia de index.html --');
  const usados = new Set(Array.from(script.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g), (m) => m[1]));
  const definidos = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]));
  const faltan = Array.from(usados).filter((id) => !definidos.has(id));
  check('todos los elementos que busca el script existen en el HTML (' + usados.size + ')',
    faltan.length === 0, 'faltan: ' + faltan.join(', '));

  const llamadasDirectas = Array.from(script.matchAll(/fetch\(\s*API_BASE/g)).length;
  check('solo apiFetch() llama a la API directamente (para que la clave viaje siempre)',
    llamadasDirectas === 1, llamadasDirectas + ' llamadas directas');
  check('apiFetch manda la cabecera X-App-Key',
    script.indexOf("headers['X-App-Key']") !== -1);
  check('la app avisa cuando el backend no tiene clave',
    script.indexOf('Este backend no tiene clave') !== -1);
  check('la app pide la clave cuando el backend la exige',
    script.indexOf('authRequired') !== -1 && script.indexOf('openKeySheet') !== -1);

  // La puerta de acceso, copiada en cada función que toca datos.
  console.log('\n-- la puerta de acceso sigue puesta en las funciones --');
  const conPuerta = ['health.mjs', 'orders.mjs', 'calendar.mjs', 'push.mjs', 'auth.mjs'];
  conPuerta.forEach((f) => {
    check(f + ' comprueba la clave', read(path.join('netlify', 'functions', f)).indexOf('sameSecret') !== -1);
  });

  const funciones = fs.readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const esperadas = ['auth-callback.mjs', 'auth.mjs', 'calendar.mjs', 'health.mjs',
    'orders.mjs', 'push.mjs', 'scheduled-reminders.mjs'];
  check('están las 7 funciones', JSON.stringify(funciones) === JSON.stringify(esperadas), funciones.join(', '));

  console.log('\n-- nada de secretos escritos en el repo --');
  const funcionesMjs = fs.readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith('.mjs'));
  ['GOOGLE_CLIENT_SECRET', 'VAPID_PRIVATE_KEY', 'APP_PASSWORD'].forEach((nombre) => {
    // Busca una asignación con valor literal, del estilo NOMBRE = "algo".
    const rx = new RegExp(nombre + '\\s*=\\s*[\'"][^\'"]+[\'"]');
    const conValorFijo = funcionesMjs
      .filter((f) => rx.test(read(path.join('netlify', 'functions', f))));
    check(nombre + ' se lee de process.env y no está escrito en el código',
      conValorFijo.length === 0, conValorFijo.join(', '));
  });
  check('netlify.toml no lleva valores de secretos',
    !/GOOGLE_CLIENT_SECRET\s*=/.test(toml) && !/VAPID_PRIVATE_KEY\s*=/.test(toml));
}

module.exports = { name: 'Configuración y coherencia del repo', run };
if (require.main === module) runStandalone(module.exports);
