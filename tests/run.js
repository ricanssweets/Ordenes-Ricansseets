'use strict';
// Corre todas las pruebas:  npm test
//
//   node tests/run.js                  todo
//   node tests/app.test.js             solo una suite
//
// No forma parte de la app y no se ejecuta en el build de Netlify: solo sirve
// para comprobar a mano que un cambio no ha roto nada.
const { runAll } = require('./helpers');

const suites = [
  require('./functions.test'),
  require('./app.test'),
  require('./sw.test'),
  require('./config.test')
];

runAll(suites).then((t) => process.exit(t.fail ? 1 : 0));
