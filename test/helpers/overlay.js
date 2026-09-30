/*
 * Loads a real overlay window (overlay.html + host + widget scripts) into jsdom, with the
 * preload `window.api` stubbed, so widget tests exercise the same code the app runs.
 *
 *   const ov = await loadOverlay('relative', { settings: { ahead: 2 } });
 *   ov.render(state);                  // what main.js sends on 'overlay:state'
 *   ov.$('.board tr')                  // query the rendered DOM
 *   ov.close();
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const Registry = require('../../src/shared/registry');
const { pickState } = require('./demo');

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');
const read = (p) => fs.readFileSync(path.join(RENDERER, p), 'utf8');

// A 2D canvas context that accepts every call and records them (jsdom has no canvas).
// `calls` has every method call; `ops` has each paint (fill / stroke / fillText / strokeText)
// with the fill and stroke style in effect at that moment.
function fakeContext2d() {
  const calls = [];
  const ops = [];
  const PAINT = new Set(['fill', 'stroke', 'fillText', 'strokeText', 'fillRect', 'strokeRect']);
  const ctx = new Proxy({ calls, ops }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return (...args) => {
        calls.push([k, ...args]);
        if (PAINT.has(k)) ops.push({ op: k, fillStyle: t.fillStyle, strokeStyle: t.strokeStyle, lineWidth: t.lineWidth, args });
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

// Options: settings / global / theme / editMode / width / height as the app would send them;
// canvasSize: [w, h] reported by canvas.clientWidth / clientHeight (jsdom has no layout);
// widgetSource: script to run instead of widgets/<id>.js (e.g. a stub widget for host tests).
async function loadOverlay(id, { settings = {}, global = {}, theme = 'carbon', editMode = false, width, height, canvasSize = [300, 60], widgetSource } = {}) {
  const def = Registry.byId(id);
  if (!def) throw new Error('unknown overlay ' + id);
  const html = read('overlay.html')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    .replace(/<link[^>]*>/g, '')
    .replace(/<script[^>]*><\/script>/g, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('error', (...a) => errors.push(a.join(' ')));
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, { url: `file:///overlay.html?id=${id}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window;

  const s = Object.assign(Registry.defaultSettingsFor(def), settings);
  const bw = width || s.bounds.width, bh = height || s.bounds.height;
  Object.defineProperty(win, 'innerWidth', { value: bw, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: bh, configurable: true });
  const t = Object.assign({}, Registry.THEMES[theme]);
  const payload = { id, settings: s, theme: t, global: { masterOpacity: 100, ...global }, editMode };

  // arguments are copied into plain Node values (objects made in the jsdom window fail deepStrictEqual)
  const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const sent = []; // window.api.send calls (e.g. overlay:setBounds)
  const invoked = []; // window.api.invoke calls
  const listeners = {};
  win.api = {
    invoke: async (ch, ...args) => {
      invoked.push([ch, ...args.map(plain)]);
      if (ch === 'overlay:init') return payload;
      if (ch === 'overlay:getBounds') return { x: 0, y: 0, width: bw, height: bh };
      return undefined;
    },
    send: (ch, ...args) => sent.push([ch, ...args.map(plain)]),
    on: (ch, cb) => { (listeners[ch] = listeners[ch] || []).push(cb); return () => {}; },
  };
  win.HTMLCanvasElement.prototype.getContext = function () { return this.__ctx || (this.__ctx = fakeContext2d()); };
  Object.defineProperty(win.HTMLCanvasElement.prototype, 'clientWidth', { get() { return canvasSize[0]; }, configurable: true });
  Object.defineProperty(win.HTMLCanvasElement.prototype, 'clientHeight', { get() { return canvasSize[1]; }, configurable: true });
  // rAF: run callbacks when the test calls flushFrames(), never on a timer
  let rafQueue = [];
  win.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  win.cancelAnimationFrame = () => {};
  // controllable clock for widgets that hold / time things with performance.now()
  const clock = { now: 1000 };
  win.performance.now = () => clock.now;

  for (const f of ['../shared/registry.js', 'lib/fmt.js', 'lib/wheels.js', 'overlay.js']) win.eval(read(f));
  win.eval(widgetSource || read(`widgets/${id}.js`));
  await win.Host.start();

  const emit = (ch, data) => (listeners[ch] || []).forEach((cb) => cb(data));
  return {
    window: win,
    document: win.document,
    settings: s,
    payload,
    sent,
    invoked,
    errors,
    $: (sel) => win.document.querySelector(sel),
    $$: (sel) => [...win.document.querySelectorAll(sel)],
    // feed a full model state; it is sliced to the overlay's `needs` like main.js does
    render(state, source = 'demo') { emit('overlay:state', pickState(state, def.needs, source)); },
    renderRaw(state) { emit('overlay:state', state); },
    configure(patch) { Object.assign(payload.settings, patch); emit('overlay:config', payload); },
    // the fake 2D context of the first canvas (or of a given one)
    ctx2d(canvas) { const c = canvas || win.document.querySelector('canvas'); return c && c.getContext('2d'); },
    // advance performance.now() by ms (performance.now is replaced by a controllable clock)
    advance(ms) { clock.now += ms; },
    flushFrames(n = 1, dt = 16) {
      for (let i = 0; i < n; i++) {
        const q = rafQueue; rafQueue = [];
        q.forEach((cb) => cb(win.performance.now() + dt * (i + 1)));
      }
    },
    headerRight: () => win.document.getElementById('header-right').innerHTML,
    close() { win.close(); },
  };
}

module.exports = { loadOverlay, fakeContext2d };
