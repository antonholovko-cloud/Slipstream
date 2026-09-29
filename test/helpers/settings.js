/*
 * Loads the real settings window (settings.html + registry.js + settings.js) into jsdom, with
 * window.api backed by a small in-memory fake of the main process.
 *
 *   const sw = await loadSettings({ page: 'classes' });
 *   sw.calls('settings:setGlobal')   // recorded invoke args
 *   sw.emit('settings:config', ...)  // push from "main"
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'src');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// config.js requires electron's `app`; give it a temp userData dir instead.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-settings-test-'));
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => tmp, getVersion: () => '0.0.0-test' } };
  return origLoad.call(this, req, ...rest);
};
const { migrate } = require('../../src/main/config');
Module._load = origLoad;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadSettings({ page = 'home', config, global = {}, classes = null, status = { source: 'demo' }, update = null, hotkeyErrors = [] } = {}) {
  const cfg = migrate(config || {});
  Object.assign(cfg.global, { autoUpdate: false }, global);
  const html = read('renderer/settings.html')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    .replace(/<link[^>]*>/g, '')
    .replace(/<script[^>]*><\/script>/g, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, { url: `file:///settings.html?page=${encodeURIComponent(page)}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window;
  win.confirm = () => true;
  win.alert = () => {};

  const log = [];
  const listeners = {};
  const emit = (ch, data) => (listeners[ch] || []).forEach((cb) => cb(data));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const payload = () => ({ config: clone(cfg), hotkeyErrors, userData: tmp, file: path.join(tmp, 'overlay-config.json'), lastSaved: null, backups: [], version: '0.0.0-test' });
  const fake = {
    classes, // what 'settings:classes' returns (null = no session)
    handlers: {
      'settings:get': () => ({ ...payload(), status, update }),
      'settings:displays': () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }],
      'settings:setGlobal': (patch) => { Object.assign(cfg.global, clone(patch)); emit('settings:config', payload()); },
      'settings:setOverlay': (id, patch) => { Object.assign(cfg.profiles[cfg.activeProfile].overlays[id], clone(patch)); emit('settings:config', payload()); },
      'settings:profile': () => undefined,
      'settings:classes': () => (typeof fake.classes === 'function' ? fake.classes() : fake.classes),
    },
  };
  win.api = {
    invoke: async (ch, ...args) => {
      log.push(JSON.parse(JSON.stringify([ch, ...args]))); // plain objects: jsdom-realm ones fail deepStrictEqual
      const h = fake.handlers[ch];
      return h ? h(...args) : undefined;
    },
    send: () => {},
    on: (ch, cb) => { (listeners[ch] = listeners[ch] || []).push(cb); return () => {}; },
  };

  win.eval(read('shared/registry.js'));
  win.eval(read('renderer/settings.js'));
  await settle(win);

  const $ = (sel, el = win.document) => el.querySelector(sel);
  const $$ = (sel, el = win.document) => [...el.querySelectorAll(sel)];
  return {
    window: win,
    document: win.document,
    config: cfg,
    fake,
    errors,
    log,
    $,
    $$,
    emit,
    calls: (ch) => log.filter((c) => c[0] === ch).map((c) => c.slice(1)),
    clearLog: () => { log.length = 0; },
    // navigate like a click on a nav link
    async go(p) { $(`#nav-main [data-page="${p}"], #nav-overlays [data-page="${p}"]`).dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await settle(win); },
    settle: (ms) => settle(win, ms),
    // set an input's value and fire the event the page listens for
    async input(el, value, type = 'input') { el.value = value; el.dispatchEvent(new win.Event(type, { bubbles: true })); await settle(win); },
    async check(el, on) { el.checked = on; el.dispatchEvent(new win.Event('change', { bubbles: true })); await settle(win); },
    async click(el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await settle(win); },
    close() { win.close(); },
  };
}

// let pending promises (invoke → then(renderPage)) and short timers run
async function settle(win, ms = 0) {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  if (ms) await sleep(ms);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

module.exports = { loadSettings };
