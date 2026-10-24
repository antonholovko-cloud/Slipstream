const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');

const race = demoRace();
const THEME = require('../../src/shared/registry').THEMES.carbon;
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

const wheel = (temp, extra = {}) => ({ temp, pressure: 165, hot: false, wear: [0.97, 0.98, 0.96], ...extra });
function withTires(tires, units = 'metric') {
  const st = structuredClone(race.state);
  st.tires = { available: true, live: true, lap: 2, ...tires };
  st.session.units = units;
  return st;
}
const cells = (ov, w) => ov.$$(`.tire.${w} .strip i`);

test('each edge is blue when cold, green in the window, red when overheating (GT3 defaults 80-95 °C)', async () => {
  const ov = await loadOverlay('tires');
  ov.render(withTires({ wheels: { lf: wheel([70, 85, 100]), rf: wheel([80, 95, 95.4]), lr: wheel([60, 61, 62]), rr: wheel([120, 110, 100]) } }));
  assert.deepEqual(cells(ov, 'lf').map((c) => c.dataset.band), ['blue', 'green', 'red']);
  assert.deepEqual(cells(ov, 'lf').map((c) => c.textContent), ['70', '85', '100']);
  assert.deepEqual(cells(ov, 'rf').map((c) => c.dataset.band), ['green', 'green', 'red'], 'the window edges are in it');
  assert.ok(cells(ov, 'lr').every((c) => c.dataset.band === 'blue'));
  assert.ok(cells(ov, 'rr').every((c) => c.dataset.band === 'red'));
  assert.ok(cells(ov, 'lf')[1].style.background.startsWith(rgb(THEME.green).replace('rgb', 'rgba').slice(0, -1)));
  assert.notEqual(cells(ov, 'lf')[1].style.color, rgb(THEME.green), 'number readable on the green');
  assert.equal(ov.headerRight(), 'live');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('the window is configurable', async () => {
  const ov = await loadOverlay('tires', { settings: { optimalMin: 60, optimalMax: 70 } });
  ov.render(withTires({ wheels: { lf: wheel([55, 65, 75]), rf: wheel([65, 65, 65]), lr: wheel([65, 65, 65]), rr: wheel([65, 65, 65]) } }));
  assert.deepEqual(cells(ov, 'lf').map((c) => c.dataset.band), ['blue', 'green', 'red']);
  ov.close();
});

test('pressures in kPa, psi or bar; cold pressure is labelled; wear on request; °F for imperial', async () => {
  const w = { lf: wheel([85, 85, 85]), rf: wheel([85, 85, 85], { pressure: 186, hot: true }), lr: wheel([85, 85, 85]), rr: wheel([85, 85, 85]) };
  const ov = await loadOverlay('tires', { settings: { showWear: true } });
  ov.render(withTires({ wheels: w }));
  assert.equal(ov.$('.tire.lf .info span').textContent, '165 kPa cold');
  assert.equal(ov.$('.tire.rf .info span').textContent, '186 kPa');
  assert.equal(ov.$$('.tire.lf .info span')[1].textContent, '96%', 'the most worn edge');
  ov.configure({ pressureUnit: 'bar' });
  ov.render(withTires({ wheels: w }));
  assert.equal(ov.$('.tire.rf .info span').textContent, '1.86 bar');
  ov.configure({ pressureUnit: 'auto' });
  ov.render(withTires({ wheels: w }, 'imperial'));
  assert.equal(ov.$('.tire.lf .info span').textContent, '23.9 psi cold');
  assert.deepEqual(cells(ov, 'lf').map((c) => c.textContent), ['85', '85', '85'], 'temperatures follow the overlay unit, not the global one');
  ov.close();
});

test('°F: numbers in °F and the window read in °F', async () => {
  const ov = await loadOverlay('tires', { settings: { tempUnit: 'f', optimalMin: 176, optimalMax: 203 } });
  ov.render(withTires({ wheels: { lf: wheel([70, 85, 100]), rf: wheel([80, 95, 95.4]), lr: wheel([85, 85, 85]), rr: wheel([85, 85, 85]) } }));
  assert.deepEqual(cells(ov, 'lf').map((c) => c.textContent), ['158', '185', '212']);
  assert.deepEqual(cells(ov, 'lf').map((c) => c.dataset.band), ['blue', 'green', 'red']);
  assert.deepEqual(cells(ov, 'rf').map((c) => c.dataset.band), ['green', 'green', 'red']);
  ov.close();
});

test('a pit-stall reading says so; no data before getting in the car', async () => {
  const ov = await loadOverlay('tires');
  const w = { lf: wheel([85, 85, 85]), rf: wheel([85, 85, 85]), lr: wheel([85, 85, 85]), rr: wheel([85, 85, 85]) };
  ov.render(withTires({ wheels: w, live: false, lap: 4 }));
  assert.equal(ov.headerRight(), 'pit reading, after lap 4');
  ov.render(withTires({ available: false, wheels: {} }));
  assert.match(ov.$('.none').textContent, /No tyre data/);
  ov.render(withTires({ wheels: w }));
  assert.equal(cells(ov, 'lf').length, 3, 'back once data arrives');
  ov.close();
});

test('demo race: every tyre has three temperatures and a pressure', async () => {
  const ov = await loadOverlay('tires');
  ov.render(race.state);
  for (const w of ['lf', 'rf', 'lr', 'rr']) {
    assert.ok(cells(ov, w).every((c) => /^\d+$/.test(c.textContent) && ['blue', 'green', 'red'].includes(c.dataset.band)), w);
  }
  assert.deepEqual(ov.errors, []);
  ov.close();
});
