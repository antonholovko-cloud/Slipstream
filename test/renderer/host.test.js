const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { THEMES } = require('../../src/shared/registry');

const T = THEMES.carbon;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rootVar = (ov, k) => ov.document.documentElement.style.getPropertyValue(k);

// A stub widget registered under a real overlay id, to test the host on its own.
// It records every update and optionally declares a natural size (fit).
const stub = (fit) => `
  window.__updates = [];
  window.__configured = 0;
  Host.register('fuel', function (root) {
    root.innerHTML = '<div class="stub"></div>';
    return {
      ${fit ? `fit: ${JSON.stringify(fit)},` : ''}
      configure() { window.__configured++; },
      update(state, ctx) { window.__updates.push({ state, settings: ctx.settings }); ctx.setHeaderRight('<b>right</b>'); },
    };
  });`;

test('theme colors become CSS variables; accent can be overridden per overlay', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub() });
  assert.equal(rootVar(ov, '--bg'), T.bg);
  assert.equal(rootVar(ov, '--text'), T.text);
  assert.equal(rootVar(ov, '--accent'), T.accent);
  for (const k of ['purple', 'green', 'red', 'yellow', 'blue', 'border']) assert.equal(rootVar(ov, '--' + k), T[k]);
  assert.equal(rootVar(ov, '--radius'), T.radius + 'px');
  assert.equal(rootVar(ov, '--font'), `'${T.font}'`);
  assert.equal(rootVar(ov, '--bg-a'), 'rgba(11,15,20,0.85)'); // default background opacity 85%
  ov.configure({ accent: '#00ff00', bgOpacity: 40 });
  assert.equal(rootVar(ov, '--accent'), '#00ff00');
  assert.equal(rootVar(ov, '--bg-a'), 'rgba(11,15,20,0.4)');
  ov.close();
});

test('other themes apply', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub(), theme: 'paddock' });
  assert.equal(rootVar(ov, '--bg'), THEMES.paddock.bg);
  assert.equal(rootVar(ov, '--accent'), THEMES.paddock.accent);
  ov.close();
});

test('overlay opacity is multiplied by the master opacity, never below 5%', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub(), settings: { opacity: 50 }, global: { masterOpacity: 50 } });
  assert.equal(ov.$('#frame').style.opacity, '0.25');
  ov.configure({ opacity: 10 });
  ov.payload.global.masterOpacity = 10;
  ov.configure({});
  assert.equal(ov.$('#frame').style.opacity, '0.05');
  ov.close();
});

test('header: title, visibility and the right-hand text from the widget', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub(), settings: { showHeader: true } });
  assert.equal(ov.$('#title').textContent, 'Fuel Calculator');
  assert.ok(!ov.document.body.classList.contains('no-header'));
  ov.renderRaw({ connected: true });
  assert.equal(ov.headerRight(), '<b>right</b>');
  ov.configure({ showHeader: false });
  assert.ok(ov.document.body.classList.contains('no-header'));
  ov.close();
});

test('edit mode: body class and a size label', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub(), editMode: true });
  assert.ok(ov.document.body.classList.contains('edit'));
  assert.match(ov.$('#edit-label').textContent, /Fuel Calculator\s+·\s+300×220/);
  ov.payload.editMode = false;
  ov.configure({});
  assert.ok(!ov.document.body.classList.contains('edit'));
  ov.close();
});

test('state goes to the widget; a new config re-renders the last state', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub() });
  const updates = () => ov.window.__updates;
  assert.equal(updates().length, 0);
  ov.renderRaw({ connected: true, n: 1 });
  assert.equal(updates().length, 1);
  assert.equal(updates()[0].state.n, 1);
  const configured = ov.window.__configured;
  ov.configure({ avgLaps: 3 });
  assert.equal(ov.window.__configured, configured + 1);
  assert.equal(updates().length, 2, 'last state re-rendered with the new settings');
  assert.equal(updates()[1].settings.avgLaps, 3);
  ov.close();
});

test('a widget error is caught and logged, not thrown', async () => {
  const src = "Host.register('fuel', () => ({ update() { throw new Error('boom'); } }));";
  const ov = await loadOverlay('fuel', { widgetSource: src });
  assert.doesNotThrow(() => ov.renderRaw({ connected: true }));
  assert.ok(ov.errors.some((e) => /boom/.test(e)));
  ov.close();
});

test('Host.css adds a style element', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: "Host.css('.x{color:red}'); Host.register('fuel', () => ({ update() {} }));" });
  assert.ok([...ov.document.head.querySelectorAll('style')].some((s) => s.textContent === '.x{color:red}'));
  ov.close();
});

test('font size: 14px x scale without fit', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub(), settings: { scale: 150 } });
  assert.equal(rootVar(ov, '--fs'), '21.00px');
  ov.close();
});

test('font size with fit: largest size that fits the box, scale can only shrink', async () => {
  // 300x220 box, natural size 10rem x 5rem -> min(300/10, 220/5) * 0.98 = 29.4px
  const ov = await loadOverlay('fuel', { widgetSource: stub({ w: 10, h: 5 }), settings: { showHeader: false, scale: 150 } });
  assert.equal(rootVar(ov, '--fs'), '29.40px');
  ov.configure({ scale: 50 });
  assert.equal(rootVar(ov, '--fs'), '14.70px');
  ov.configure({ autoFit: false, scale: 100 });
  assert.equal(rootVar(ov, '--fs'), '14.00px');
  ov.close();
});

test('font size with fit is clamped to 8..48px', async () => {
  const big = await loadOverlay('fuel', { widgetSource: stub({ w: 1, h: 1 }), settings: { showHeader: false } });
  assert.equal(rootVar(big, '--fs'), '48.00px');
  big.close();
  const small = await loadOverlay('fuel', { widgetSource: stub({ w: 1000, h: 1000 }), settings: { showHeader: false } });
  assert.equal(rootVar(small, '--fs'), '8.00px');
  small.close();
});

test('fitHeight: sizes the box height to the contents with an exact setBounds after a short delay', async () => {
  // width decides: 300 / 10 * 0.98 = 29.4px; height = 5rem * 29.4 = 147 (+ 4px padding) = 151
  const ov = await loadOverlay('fuel', { widgetSource: stub({ w: 10, h: 5, padPx: 4, fitHeight: true }), settings: { showHeader: false } });
  assert.equal(rootVar(ov, '--fs'), '29.40px');
  assert.equal(ov.sent.length, 0, 'debounced');
  await sleep(200);
  const call = ov.sent.find((s) => s[0] === 'overlay:setBounds');
  assert.ok(call, 'setBounds sent');
  assert.deepEqual(call.slice(1), ['fuel', { x: 0, y: 0, width: 300, height: 151 }, true, { exact: true }]);
  ov.close();
});

test('fitHeight: no request when the height already matches', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub({ w: 10, h: 220 / 29.4, fitHeight: true }), settings: { showHeader: false } });
  await sleep(200);
  assert.equal(ov.sent.filter((s) => s[0] === 'overlay:setBounds').length, 0);
  ov.close();
});

// ---- edit mode dragging ----
const pointer = (win, type, x, y) => new win.MouseEvent(type, { bubbles: true, button: 0, screenX: x, screenY: y });
const flush = () => sleep(0);

test('dragging moves the window: live updates while moving, final one on release', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub(), editMode: true });
  const body = ov.document.body;
  body.dispatchEvent(pointer(ov.window, 'pointerdown', 100, 100));
  await flush();
  body.dispatchEvent(pointer(ov.window, 'pointermove', 130, 90));
  body.dispatchEvent(pointer(ov.window, 'pointerup', 150, 80));
  const moves = ov.sent.filter((s) => s[0] === 'overlay:setBounds');
  assert.deepEqual(moves[0].slice(1), ['fuel', { x: 30, y: -10, width: 300, height: 220 }, false]);
  assert.deepEqual(moves[1].slice(1), ['fuel', { x: 50, y: -20, width: 300, height: 220 }, true]);
  ov.close();
});

test('no dragging outside edit mode', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub() });
  ov.document.body.dispatchEvent(pointer(ov.window, 'pointerdown', 100, 100));
  await flush();
  ov.document.body.dispatchEvent(pointer(ov.window, 'pointerup', 150, 150));
  assert.equal(ov.sent.length, 0);
  ov.close();
});

test('resizing with the grip changes width and height', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub(), editMode: true });
  const grip = ov.$('#grip');
  grip.dispatchEvent(pointer(ov.window, 'pointerdown', 10, 10));
  await flush();
  grip.dispatchEvent(pointer(ov.window, 'pointerup', 40, 13));
  const last = ov.sent.filter((s) => s[0] === 'overlay:setBounds').at(-1);
  assert.deepEqual(last.slice(1), ['fuel', { x: 0, y: 0, width: 330, height: 223 }, true]);
  assert.equal(ov.invoked.filter((i) => i[0] === 'settings:setOverlay').length, 0, 'small vertical change keeps fitHeight');
  ov.close();
});

test('resizing the height by hand turns off fitHeight for fitted widgets', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub({ w: 10, h: 5 }), editMode: true, settings: { fitHeight: true } });
  const grip = ov.$('#grip');
  grip.dispatchEvent(pointer(ov.window, 'pointerdown', 10, 10));
  await flush();
  grip.dispatchEvent(pointer(ov.window, 'pointerup', 10, 60));
  assert.deepEqual(ov.invoked.find((i) => i[0] === 'settings:setOverlay'), ['settings:setOverlay', 'fuel', { fitHeight: false }]);
  assert.equal(ov.settings.fitHeight, false);
  ov.close();
});

test('arrow keys nudge in edit mode (shift = 10px, ctrl = resize)', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub(), editMode: true });
  const key = (k, mods = {}) => ov.window.dispatchEvent(new ov.window.KeyboardEvent('keydown', { key: k, ...mods }));
  key('ArrowRight'); await flush();
  key('ArrowDown', { shiftKey: true }); await flush();
  key('ArrowLeft', { ctrlKey: true }); await flush();
  key('a'); await flush();
  const b = ov.sent.filter((s) => s[0] === 'overlay:setBounds').map((s) => s[2]);
  assert.deepEqual(b, [
    { x: 1, y: 0, width: 300, height: 220 },
    { x: 0, y: 10, width: 300, height: 220 },
    { x: 0, y: 0, width: 299, height: 220 },
  ]);
  ov.close();
});

test('arrow keys do nothing outside edit mode', async () => {
  const ov = await loadOverlay('fuel', { widgetSource: stub() });
  ov.window.dispatchEvent(new ov.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  await flush();
  assert.equal(ov.sent.length, 0);
  ov.close();
});
