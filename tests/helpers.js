'use strict';
// Utilidades compartidas por las pruebas. No forma parte de la app: esto solo
// se ejecuta a mano con `npm test`, nunca en el build de Netlify.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { randomUUID } = require('node:crypto');

const REPO = path.resolve(__dirname, '..');
const FUNCTIONS_DIR = path.join(REPO, 'netlify', 'functions');

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/^\uFEFF/, '');

// --------------------------------------------------------------------------
// Cargar una función de Netlify dentro de un sandbox, con equivalentes de lo
// que Netlify le da en producción: Blobs (getStore), web-push, variables de
// entorno y fetch.
// --------------------------------------------------------------------------
function loadFunctionSource(file) {
  let src = fs.readFileSync(path.join(FUNCTIONS_DIR, file), 'utf8').replace(/^\uFEFF/, '');
  src = src.replace(/^import .*$/gm, '');
  src = src.replace(/export const config/, 'const config');
  src = src.replace(/export default async \(([^)]*)\)\s*=>\s*\{/, 'async function run($1) {');
  return src + '\nglobalThis.__run = run;';
}

const okJson = (obj) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });

function makeFunctionContext(opts) {
  const o = opts || {};
  const store = o.store || {};
  const ctx = {
    getStore: () => ({
      get: async (k) => (k in store ? JSON.stringify(store[k]) : null),
      set: async (k, v) => { store[k] = JSON.parse(v); },
      delete: async (k) => { delete store[k]; }
    }),
    webpush: o.webpush || { setVapidDetails() {}, sendNotification: async () => ({}) },
    randomUUID,
    process: { env: o.env || {} },
    console: { log() {}, warn() {}, error() {} },
    Response, Headers, Request, URL, URLSearchParams,
    fetch: o.fetch || (async () => okJson({ refresh_token: 'rt' }))
  };
  vm.createContext(ctx);
  vm.runInContext(loadFunctionSource(o.file), ctx);
  return { ctx, store };
}

// Llama a una función como la llamaría Netlify: un Request y un context.
async function callFunction(file, opts) {
  const o = opts || {};
  const { ctx, store } = makeFunctionContext(Object.assign({}, o, { file }));
  const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (o.key !== undefined) headers['x-app-key'] = o.key;
  const req = new Request(o.url || 'https://sitio.netlify.app/.netlify/functions/x', {
    method: o.method || 'POST',
    headers,
    body: o.body
  });
  const res = await ctx.__run(req, { site: { url: 'https://sitio.netlify.app' } });
  let body = null;
  try { body = await res.clone().json(); } catch (e) { /* respuesta sin JSON */ }
  return { status: res.status, body, res, store, location: res.headers.get('location') };
}

// --------------------------------------------------------------------------
// DOM simulado para ejecutar la app entera (index.html) sin navegador.
// textContent/innerHTML imitan a un navegador de verdad: al asignar textContent
// se recalcula innerHTML con &, < y > escapados, que es lo que hace escapeHTML.
// --------------------------------------------------------------------------
const escapeText = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function makeEl(tag, id) {
  let text = '', html = '';
  const listeners = {};
  const classes = new Set();
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: id || '',
    value: '', hidden: false, dataset: {}, style: {}, files: null, className: '',
    children: [],
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); }
        else if (on) { classes.add(c); } else { classes.delete(c); }
      }
    },
    get textContent() { return text; },
    set textContent(v) { text = v == null ? '' : String(v); html = escapeText(text); },
    get innerHTML() { return html; },
    set innerHTML(v) { html = v == null ? '' : String(v); text = ''; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    dispatch(type, extra) {
      const ev = Object.assign({
        type, target: el, preventDefault() {}, stopPropagation() {}, key: undefined
      }, extra || {});
      (listeners[type] || []).slice().forEach((fn) => fn(ev));
      return el;
    },
    click() { el.dispatch('click'); return el; },
    focus() {}, blur() {}, remove() {},
    appendChild(child) { el.children.push(child); return child; },
    setAttribute(k, v) { el[k] = v; },
    getAttribute(k) { return el[k] === undefined ? null : el[k]; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; }
  };
  return el;
}

// Ejecuta el JS real de index.html contra el DOM simulado.
// `seed` es un objeto { 'clave-de-localStorage': valor }.
async function loadApp(seed) {
  const html = read('index.html');
  const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('no se encontró el script embebido en index.html');
  const code = m[1];

  const els = new Map();
  const document = {
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl('#id', id)); return els.get(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    createElement: (tag) => makeEl(tag),
    body: makeEl('body'),
    activeElement: null
  };

  const mkStorage = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
      _map: map
    };
  };
  const localStorage = mkStorage();
  const sessionStorage = mkStorage();
  Object.keys(seed || {}).forEach((k) => localStorage.setItem(k, seed[k]));

  const errors = [];
  const ctx = {
    document,
    window: { addEventListener() {}, location: { protocol: 'https:', hostname: 'x', search: '', pathname: '/' } },
    navigator: {},
    location: { protocol: 'https:', hostname: 'x', search: '', pathname: '/' },
    history: { replaceState() {} },
    localStorage, sessionStorage,
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
    Blob: function () {}, FileReader: function () {}, atob: (s) => s,
    URLSearchParams,
    URL: class extends URL {
      static createObjectURL() { return 'blob:x'; }
      static revokeObjectURL() {}
    }
  };
  ctx.Notification = { permission: 'denied' };
  ctx.window.Notification = ctx.Notification;

  const onRejection = (e) => errors.push('rechazo sin manejar: ' + e);
  process.on('unhandledRejection', onRejection);

  vm.createContext(ctx);
  let startupError = null;
  try { vm.runInContext(code, ctx); } catch (e) { startupError = e; }
  await new Promise((r) => setTimeout(r, 40));
  process.removeListener('unhandledRejection', onRejection);

  return {
    ctx, els, localStorage, sessionStorage, errors, startupError,
    el: (id) => document.getElementById(id),
    // Lee/escribe variables del script (orders, etc.): no son propiedades del
    // global porque están declaradas con let/const en el propio script.
    eval: (expr) => vm.runInContext(expr, ctx),
    run: (stmt) => vm.runInContext(stmt, ctx)
  };
}

// --------------------------------------------------------------------------
// Informe
// --------------------------------------------------------------------------
function makeReporter() {
  const state = { pass: 0, fail: 0 };
  const check = (label, cond, detail) => {
    if (cond) { state.pass++; console.log('  PASS  ' + label); }
    else { state.fail++; console.log('  FALLA ' + label + (detail ? '   -> ' + detail : '')); }
  };
  return { state, check };
}

async function runAll(mods) {
  const total = { pass: 0, fail: 0 };
  for (const mod of mods) {
    console.log('\n' + '='.repeat(72));
    console.log('== ' + mod.name);
    console.log('='.repeat(72));
    const { state, check } = makeReporter();
    try {
      await mod.run(check);
    } catch (e) {
      state.fail++;
      console.log('  FALLA la suite se rompió   -> ' + (e && e.stack ? e.stack.split('\n')[0] : e));
    }
    console.log('  -- ' + state.pass + ' PASS, ' + state.fail + ' FALLA');
    total.pass += state.pass;
    total.fail += state.fail;
  }
  console.log('\n' + '='.repeat(72));
  console.log('TOTAL: ' + total.pass + ' PASS, ' + total.fail + ' FALLA');
  console.log('='.repeat(72));
  return total;
}

async function runStandalone(mod) {
  const { state, check } = makeReporter();
  console.log('\n== ' + mod.name);
  await mod.run(check);
  console.log('\n' + state.pass + ' PASS, ' + state.fail + ' FALLA');
  process.exit(state.fail ? 1 : 0);
}

module.exports = {
  REPO, FUNCTIONS_DIR, read,
  callFunction, loadApp, makeEl, escapeText,
  makeReporter, runAll, runStandalone
};
