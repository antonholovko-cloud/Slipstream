const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');

const state = (flags, carFlags = 0) => ({ connected: true, session: { flags, carFlags }, player: {} });
const shown = (ov) => ({
  visible: ov.$('.flagw').style.visibility,
  cls: ov.$('.flag').className,
  label: ov.$('.label').textContent,
});

const CASES = [
  [0x1, 'checkered', 'Finish'],
  [0x10, 'red', 'Red flag'],
  [0x20000, 'black', 'Disqualified'],
  [0x10000, 'black', 'Black flag'],
  [0x100000, 'meatball', 'Repair'],
  [0x4000, 'caution', 'Caution'],
  [0x8000, 'caution', 'Caution'],
  [0x40, 'debris', 'Debris'],
  [0x8, 'yellow', 'Yellow'],
  [0x100, 'yellow', 'Yellow waving'],
  [0x200, 'onetogreen', 'One to green'],
  [0x20, 'blue', 'Blue flag'],
  [0x2, 'white', 'Last lap'],
];

for (const [bit, cls, label] of CASES) {
  test(`flag bit 0x${bit.toString(16)} shows ${label}`, async () => {
    const ov = await loadOverlay('flags');
    ov.renderRaw(state(bit));
    assert.deepEqual(shown(ov), { visible: 'visible', cls: 'flag ' + cls, label });
    ov.close();
  });
}

test('per-car flags are combined with session flags', async () => {
  const ov = await loadOverlay('flags');
  ov.renderRaw(state(0, 0x10000));
  assert.equal(shown(ov).label, 'Black flag');
  ov.close();
});

test('priority: the most important flag wins', async () => {
  const ov = await loadOverlay('flags');
  ov.renderRaw(state(0x1 | 0x10 | 0x8 | 0x20));
  assert.equal(shown(ov).cls, 'flag checkered');
  ov.renderRaw(state(0x8 | 0x20 | 0x2));
  assert.equal(shown(ov).cls, 'flag yellow');
  ov.renderRaw(state(0x20 | 0x2));
  assert.equal(shown(ov).cls, 'flag blue');
  ov.close();
});

test('blue and meatball can be turned off', async () => {
  const ov = await loadOverlay('flags', { settings: { showBlue: false, showMeatball: false } });
  ov.renderRaw(state(0x20 | 0x2));
  assert.equal(shown(ov).cls, 'flag white');
  ov.renderRaw(state(0x100000));
  assert.equal(shown(ov).visible, 'hidden');
  ov.close();
});

test('flag clears: hidden again', async () => {
  const ov = await loadOverlay('flags');
  ov.renderRaw(state(0x8));
  assert.equal(shown(ov).visible, 'visible');
  ov.renderRaw(state(0));
  assert.equal(shown(ov).visible, 'hidden');
  ov.close();
});

// BUG (src/renderer/widgets/flags.js): lastKey starts as '' which equals the key for "no flag",
// so the very first no-flag update returns early and the empty flag box (with its drop shadow)
// stays visible until the first real flag comes out.
test('no flag on the first update: hidden', async () => {
  const ov = await loadOverlay('flags');
  ov.renderRaw(state(0));
  assert.equal(shown(ov).visible, 'hidden');
  ov.close();
});

test('green shows for greenSeconds after it comes out, then hides', async () => {
  const ov = await loadOverlay('flags', { settings: { greenSeconds: 5 } });
  const perf = ov.window.performance;
  let now = 1000;
  perf.now = () => now;
  ov.renderRaw(state(0x4));
  assert.deepEqual(shown(ov), { visible: 'visible', cls: 'flag green', label: 'Green' });
  now += 4000;
  ov.renderRaw(state(0x4));
  assert.equal(shown(ov).visible, 'visible');
  now += 2000;
  ov.renderRaw(state(0x4));
  assert.equal(shown(ov).visible, 'hidden');
  ov.close();
});

test('green can be turned off', async () => {
  const ov = await loadOverlay('flags', { settings: { showGreen: false } });
  ov.renderRaw(state(0x8));
  ov.renderRaw(state(0x4));
  assert.equal(shown(ov).visible, 'hidden');
  ov.close();
});

test('edit mode previews a yellow flag when nothing is out', async () => {
  const ov = await loadOverlay('flags', { editMode: true });
  ov.renderRaw(state(0));
  assert.deepEqual(shown(ov), { visible: 'visible', cls: 'flag yellow', label: 'Preview' });
  ov.close();
});

test('text label can be hidden', async () => {
  const ov = await loadOverlay('flags', { settings: { showText: false } });
  ov.renderRaw(state(0x10));
  assert.equal(ov.$('.label').textContent, '');
  assert.equal(ov.$('.label').style.display, 'none');
  ov.close();
});
