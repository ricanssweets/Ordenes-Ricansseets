'use strict';
// Pruebas de la app completa: se ejecuta el JS real de index.html contra un DOM
// simulado, así que cubre el arranque, el dibujado, la fusión con la nube y las
// funciones nuevas (deshacer al borrar y sugerencias de clientes).
const { loadApp, makeReporter, runStandalone } = require('./helpers');

const ORDERS_KEY = 'ricans_sweets_orders_v1';
const SYNCED_KEY = 'ricans_sweets_synced_ids';
const PENDING_KEY = 'ricans_sweets_pending_deletes';

function todayIso(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const seedOrders = () => JSON.stringify([
  { id: 'o1', name: 'María "La Jefa" <b>', date: todayIso(0), done: false, phone: '561-524-5454', price: '45' },
  { id: 'o2', name: 'Fecha rota', date: 'no-es-fecha', done: false },
  { id: 'o3', name: 'Ya entregado', date: todayIso(0), done: true }
]);

async function run(check) {
  // ------------------------------------------------------------------ arranque ---
  console.log('\n-- la app arranca y dibuja --');
  const app = await loadApp({ [ORDERS_KEY]: seedOrders() });

  check('el script se ejecuta entero', app.startupError === null,
    app.startupError && app.startupError.message);
  check('sin errores en consola', app.errors.length === 0, app.errors.join(' | '));

  const list = app.el('listContainer').innerHTML;
  check('se dibujaron las tarjetas', list.indexOf('order-card') !== -1, 'sin tarjetas');
  check('las comillas del nombre se escapan (va dentro de atributos)',
    list.indexOf('&quot;') !== -1, 'sin escapar');
  check('el HTML del nombre no se inyecta', list.indexOf('<b>') === -1, 'se inyectó HTML');
  check('una fecha corrupta dice "sin fecha"', list.indexOf('sin fecha') !== -1, 'no aparece');
  check('statUrgent no cuenta la fecha corrupta',
    String(app.el('statUrgent').textContent) === '1', 'statUrgent=' + app.el('statUrgent').textContent);
  check('statTotal cuenta los pendientes',
    String(app.el('statTotal').textContent) === '2', 'statTotal=' + app.el('statTotal').textContent);

  check('daysUntil(null) es null', app.eval('daysUntil(null)') === null, String(app.eval('daysUntil(null)')));
  check('daysUntil("basura") es null', app.eval('daysUntil("basura")') === null, String(app.eval('daysUntil("basura")')));
  check('daysUntil de hoy es 0', app.eval('daysUntil("' + todayIso(0) + '")') === 0, String(app.eval('daysUntil("' + todayIso(0) + '")')));

  // ------------------------------------------------------- fusión con la nube ---
  console.log('\n-- fusión de pedidos entre dispositivos --');
  const merge = (local, remote, synced, pending) => {
    app.run('orders = ' + JSON.stringify(local) + ';');
    app.localStorage.setItem(SYNCED_KEY, JSON.stringify(synced || []));
    app.localStorage.setItem(PENDING_KEY, JSON.stringify(pending || []));
    return app.eval('mergeOrders(' + JSON.stringify(remote) + ')').map((o) => o.id).sort().join(',');
  };
  const nube = (id, at) => ({ id, name: 'nube', date: '2026-01-01', updatedAt: at });

  check('dispositivo nuevo: conserva lo local Y lo de la nube',
    merge([{ id: 'B', name: 'local', date: '2026-01-01' }], [nube('A', 1)], []) === 'A,B',
    merge([{ id: 'B', name: 'local', date: '2026-01-01' }], [nube('A', 1)], []));

  check('un pedido borrado en otro dispositivo NO se resucita',
    merge([{ id: 'A', name: 'x', date: '2026-01-01', updatedAt: 1 }], [], ['A']) === '',
    merge([{ id: 'A', name: 'x', date: '2026-01-01', updatedAt: 1 }], [], ['A']));

  check('lo anotado sin conexión se conserva (no lo pisa la nube)',
    merge([{ id: 'NUEVO', name: 'n', date: '2026-01-01' }], [nube('A', 1)], ['A']) === 'A,NUEVO');

  check('borrado sin conexión: NO reaparece al recargar',
    merge([], [nube('A', 100)], ['A'], [{ id: 'A', at: 200 }]) === '');

  check('pero una edición posterior en la nube sí gana (no se oculta)',
    merge([], [nube('A', 300)], ['A'], [{ id: 'A', at: 200 }]) === 'A');

  // -------------------------------------------------- #6 deshacer al borrar ---
  console.log('\n-- #6 deshacer al borrar --');
  // Se vuelve a poner el contenido inicial: las pruebas de fusión de arriba
  // dejan `orders` con lo que dejó el último caso.
  app.run('orders = ' + seedOrders() + '; render();');
  const before = app.eval('orders.length');
  check('partimos de los 3 pedidos iniciales', before === 3, 'hay ' + before);

  app.eval('deleteOrder("o1")');
  check('borrar pide confirmación', app.el('confirmModal').classList.contains('open') === true);

  app.el('confirmOk').dispatch('click');
  check('tras confirmar, el pedido se va', app.eval('orders.length') === before - 1,
    'quedan ' + app.eval('orders.length'));
  const pend = JSON.parse(app.localStorage.getItem(PENDING_KEY) || '[]');
  check('  y se deja lápida para que la nube lo borre',
    pend.some((d) => d.id === 'o1'), JSON.stringify(pend));

  const toastEl = app.el('toast');
  const undoBtn = toastEl.children.filter((c) => c.textContent === 'Deshacer')[0];
  check('el aviso ofrece Deshacer', !!undoBtn, 'hijos del aviso: ' + toastEl.children.length);

  if (undoBtn) {
    undoBtn.dispatch('click');
    check('deshacer devuelve el pedido', app.eval('orders.length') === before,
      'quedan ' + app.eval('orders.length'));
    check('  y quita la lápida (si no, la nube lo seguiría dando por borrado)',
      JSON.parse(app.localStorage.getItem(PENDING_KEY) || '[]').some((d) => d.id === 'o1') === false,
      app.localStorage.getItem(PENDING_KEY));
    check('  y vuelve en su posición original',
      app.eval('orders.findIndex(function(o){ return o.id === "o1"; })') === 0,
      'posición ' + app.eval('orders.findIndex(function(o){ return o.id === "o1"; })'));
    check('  y con marca de tiempo nueva para ganar en la fusión',
      app.eval('Number(orders[0].updatedAt) > 0') === true);
  } else {
    check('deshacer devuelve el pedido', false, 'no se encontró el botón Deshacer');
  }

  // ------------------------------------------------ #4 sugerencias de clientes ---
  console.log('\n-- #4 sugerencias de clientes --');
  const app2 = await loadApp({
    [ORDERS_KEY]: JSON.stringify([
      { id: 'c1', name: 'María Rivera', date: todayIso(-10), done: true, phone: '561-524-5454', updatedAt: 100 },
      { id: 'c2', name: 'Luis Colón', date: todayIso(-5), done: true, phone: '787-111-2222', updatedAt: 200 }
    ])
  });

  check('busca por nombre', app2.eval('matchClients("mar").length') === 1,
    String(app2.eval('matchClients("mar").length')));
  check('busca por teléfono', app2.eval('matchClients("787111").length') === 1,
    String(app2.eval('matchClients("787111").length')));
  check('no distingue mayúsculas', app2.eval('matchClients("LUIS").length') === 1);
  check('con una sola letra no sugiere nada (molestaría)', app2.eval('matchClients("m").length') === 0);
  check('sin coincidencias devuelve vacío', app2.eval('matchClients("zzz").length') === 0);

  app2.el('fName').value = 'mar';
  app2.el('fName').dispatch('input');
  const suggestHtml = app2.el('clientSuggest').innerHTML;
  check('la lista se muestra al escribir', app2.el('clientSuggest').hidden === false);
  check('la sugerencia incluye el nombre', suggestHtml.indexOf('María Rivera') !== -1, suggestHtml);
  check('  y el teléfono, que es lo que evita erratas', suggestHtml.indexOf('561-524-5454') !== -1, suggestHtml);
  check('  con aria-expanded para lectores de pantalla',
    app2.el('fName').getAttribute('aria-expanded') === 'true');

  app2.run('pickClient({ name: "María Rivera", phone: "561-524-5454" })');
  check('elegir una sugerencia rellena nombre y teléfono',
    app2.el('fName').value === 'María Rivera' && app2.el('fPhone').value === '561-524-5454',
    app2.el('fName').value + ' / ' + app2.el('fPhone').value);
  check('  y cierra la lista', app2.el('clientSuggest').hidden === true);

  app2.el('fPhone').value = '787-000-1111';
  app2.run('pickClient({ name: "Otro Cliente", phone: "561-999-8888" })');
  check('no pisa un teléfono ya escrito',
    app2.el('fPhone').value === '787-000-1111', app2.el('fPhone').value);

  app2.el('fName').value = 'mar';
  app2.el('fName').dispatch('input');
  app2.run('clearForm()');
  check('cerrar/limpiar la hoja esconde las sugerencias',
    app2.el('clientSuggest').hidden === true);

  // ------------------------------------------------- #1 compartir por WhatsApp ---
  console.log('\n-- #1 compartir por WhatsApp --');
  const app3 = await loadApp({
    [ORDERS_KEY]: JSON.stringify([
      { id: 'w1', name: 'María Rivera', date: todayIso(1), time: '15:00', done: false,
        phone: '561-524-5454', info: 'Flan de queso grande', price: '45', deposit: '20' }
    ])
  });
  const href = app3.eval('whatsappHref(orders[0])');
  check('el enlace abre WhatsApp con el número de Puerto Rico (+1)',
    href.indexOf('https://wa.me/15615245454?text=') === 0, href.slice(0, 60));
  const msg = decodeURIComponent(href.split('?text=')[1]);
  check('el mensaje saluda al cliente', msg.indexOf('María Rivera') !== -1);
  check('  dice cuándo es la entrega', msg.indexOf('mañana') !== -1, msg);
  check('  lleva el detalle del pedido', msg.indexOf('Flan de queso grande') !== -1);
  check('  el total', msg.indexOf('$45.00') !== -1);
  check('  el adelanto y lo que falta por pagar',
    msg.indexOf('$20.00') !== -1 && msg.indexOf('$25.00') !== -1, msg);
  check('la tarjeta trae el botón de WhatsApp',
    app3.el('listContainer').innerHTML.indexOf('class="wa"') !== -1);
  check('sin teléfono, abre WhatsApp para elegir el contacto',
    app3.eval('whatsappHref({name:"X", date:"2026-01-01"})').indexOf('https://wa.me/?text=') === 0);

  // ------------------------------------------------- #3 adelanto y saldo ---
  console.log('\n-- #3 adelanto y saldo pendiente --');
  check('calcúla lo que falta', app3.eval('balanceOf({price:"45", deposit:"20"})') === 25);
  check('sin adelanto, falta el total', app3.eval('balanceOf({price:"45"})') === 45);
  check('sin precio no hay saldo', app3.eval('balanceOf({deposit:"20"})') === null);
  check('la tarjeta muestra lo que falta',
    app3.el('listContainer').innerHTML.indexOf('Falta $25.00') !== -1);
  app3.run('orders[0].deposit = "45"; render();');
  check('  y dice "Pagado" cuando el adelanto cubre el total',
    app3.el('listContainer').innerHTML.indexOf('Pagado') !== -1);
  app3.run('orders[0].deposit = ""; render();');
  check('  y no muestra nada si no hay adelanto apuntado',
    app3.el('listContainer').innerHTML.indexOf('Falta ') === -1);

  app3.el('fPrice').value = '100';
  app3.el('fDeposit').value = '40';
  app3.run('updateBalanceHint()');
  check('el aviso del formulario calcula mientras escribes',
    app3.el('balanceHint').innerHTML.indexOf('$60.00') !== -1 && app3.el('balanceHint').hidden === false,
    app3.el('balanceHint').innerHTML);
  app3.el('fDeposit').value = '100';
  app3.run('updateBalanceHint()');
  check('  y avisa cuando está pagado completo',
    app3.el('balanceHint').innerHTML.indexOf('Pagado') !== -1);
  app3.el('fDeposit').value = '';
  app3.run('updateBalanceHint()');
  check('  y se oculta si no hay adelanto', app3.el('balanceHint').hidden === true);

  // ------------------------------------------------------ #2 repetir pedido ---
  console.log('\n-- #2 repetir un pedido --');
  app3.run('orders = ' + JSON.stringify([
    { id: 'r1', name: 'Luis Colón', date: todayIso(-3), time: '10:00', done: true,
      phone: '787-111-2222', info: 'Tres leches mini x6', price: '30', deposit: '15' }
  ]) + '; render();');
  app3.run('repeatOrder("r1")');
  check('rellena el nombre', app3.el('fName').value === 'Luis Colón', app3.el('fName').value);
  check('  el teléfono', app3.el('fPhone').value === '787-111-2222', app3.el('fPhone').value);
  check('  los detalles', app3.el('fInfo').value === 'Tres leches mini x6');
  check('  la hora', app3.el('fTime').value === '10:00');
  check('  el precio', app3.el('fPrice').value === '30');
  check('  la fecha queda VACÍA, que es lo único que hay que cambiar',
    app3.el('fDate').value === '', app3.el('fDate').value);
  check('  el adelanto NO se copia', app3.el('fDeposit').value === '', app3.el('fDeposit').value);
  check('  es un pedido nuevo, no una edición del anterior',
    app3.eval('editingId') === null, String(app3.eval('editingId')));
  check('  y el título de la hoja lo dice', app3.el('sheetTitle').textContent === 'Repetir pedido');
  check('la tarjeta trae el botón Repetir',
    app3.el('listContainer').innerHTML.indexOf('data-repeat') !== -1);

  // ------------------------------------------- #4 agrupado por día de entrega ---
  console.log('\n-- #4 agrupado por día de entrega --');
  const seed4 = [
    { id: 'd1', name: 'Ana', date: todayIso(0), time: '09:00', done: false, price: '20' },
    { id: 'd2', name: 'Bea', date: todayIso(1), time: '11:00', done: false, price: '30' },
    { id: 'd3', name: 'Car', date: todayIso(1), time: '08:00', done: false, price: '10' },
    { id: 'd4', name: 'Dan', date: todayIso(40), done: false, price: '5' }
  ];
  const app4 = await loadApp({ [ORDERS_KEY]: JSON.stringify(seed4) });
  const list4 = app4.el('listContainer').innerHTML;
  const cabeceras = (list4.match(/class="day-head"/g) || []).length;
  check('hay una cabecera por cada día de entrega', cabeceras === 3, 'hay ' + cabeceras);
  check('el primer grupo es HOY', list4.indexOf('Hoy · ') !== -1);
  check('el segundo es MAÑANA', list4.indexOf('Mañana · ') !== -1);
  check('dentro del día se ordena por hora (08:00 antes de 11:00)',
    list4.indexOf('Car') < list4.indexOf('Bea'), 'orden incorrecto');
  check('la cabecera del día suma el dinero de ese día',
    list4.indexOf('$40.00') !== -1, 'no aparece $40.00 (30+10)');
  check('ya no aparece la etiqueta genérica "Pendientes"',
    list4.indexOf('>Pendientes<') === -1);

  // ------------------------------------------------------ #5 total del mes ---
  console.log('\n-- #5 total de entregas del mes --');
  const ym = todayIso(0).slice(0, 7);
  const delMes = seed4.filter((o) => o.date.slice(0, 7) === ym);
  const totalMes = delMes.reduce((s, o) => s + Number(o.price), 0);
  const mesLine = app4.el('monthLine');
  check('se muestra la línea del mes', mesLine.hidden === false);
  check('  con el total de las entregas de este mes',
    mesLine.innerHTML.indexOf('$' + totalMes.toFixed(2)) !== -1,
    mesLine.innerHTML + ' (esperado $' + totalMes.toFixed(2) + ')');
  check('  y con el número de pedidos de este mes',
    mesLine.innerHTML.indexOf('<strong>' + delMes.length + '</strong>') !== -1,
    mesLine.innerHTML);
}

module.exports = { name: 'La app (arranque, fusión, deshacer, sugerencias)', run };
if (require.main === module) runStandalone(module.exports);
