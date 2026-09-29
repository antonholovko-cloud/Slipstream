const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');

const race = demoRace();
const THEME = require('../../src/shared/registry').THEMES.carbon;

function withFuel(fuel, units = 'metric') {
  const st = structuredClone(race.state);
  st.fuel = { level: 20, pct: 0.2, perHour: 40, max: 100, laps: [4, 4, 4, 4, 4], lapsToGo: 10, ...fuel };
  st.session.units = units;
  return st;
}
// grid rows as { label: value }
const grid = (ov) => {
  const s = ov.$$('.grid span').map((x) => x.textContent);
  const out = {};
  for (let i = 0; i < s.length; i += 2) out[s[i]] = s[i + 1];
  return out;
};
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

test('averages, laps left, fuel to finish, amount to add and stops', async () => {
  const ov = await loadOverlay('fuel', { settings: { avgLaps: 5, safetyMargin: 0.5 } });
  ov.render(withFuel({}));
  const big = ov.$$('.big b').map((b) => b.textContent);
  assert.deepEqual(big, ['20.00', '5.0']);
  const g = grid(ov);
  assert.equal(g['Avg / lap'], '4.00');
  assert.equal(g['Last lap'], '4.00');
  assert.equal(g['Max lap'], '4.00');
  assert.equal(g['Laps to go'], '10.0');
  assert.equal(g['To finish'], '42.00'); // (10 + 0.5) * 4
  assert.equal(g['Add at stop'], '+22.00');
  assert.equal(g['Stops needed'], '1');
  assert.equal(ov.headerRight(), '5 lap avg');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('only the last avgLaps laps are averaged; max shows the worst', async () => {
  const ov = await loadOverlay('fuel', { settings: { avgLaps: 2 } });
  ov.render(withFuel({ laps: [9, 9, 3, 5] }));
  const g = grid(ov);
  assert.equal(g['Avg / lap'], '4.00');
  assert.equal(g['Last lap'], '5.00');
  assert.equal(g['Max lap'], '5.00');
  assert.equal(ov.headerRight(), '2 lap avg');
  ov.close();
});

test('enough fuel: add shows OK and 0 stops', async () => {
  const ov = await loadOverlay('fuel');
  ov.render(withFuel({ level: 80 }));
  const g = grid(ov);
  assert.equal(g['Add at stop'], 'OK');
  assert.equal(g['Stops needed'], '0');
  ov.close();
});

test('more than a tank to add: capped at a tank, several stops', async () => {
  const ov = await loadOverlay('fuel', { settings: { safetyMargin: 0 } });
  ov.render(withFuel({ level: 0, max: 50, lapsToGo: 30 })); // 120 L needed
  const g = grid(ov);
  assert.equal(g['Add at stop'], '+50.00');
  assert.equal(g['Stops needed'], '3');
  ov.close();
});

test('no laps yet: dashes and "collecting…"', async () => {
  const ov = await loadOverlay('fuel');
  ov.render(withFuel({ laps: [] }));
  const g = grid(ov);
  assert.equal(g['Avg / lap'], '–');
  assert.equal(g['To finish'], '–');
  assert.equal(g['Add at stop'], '–');
  assert.equal(ov.$$('.big b')[1].textContent, '–');
  assert.equal(ov.headerRight(), 'collecting…');
  ov.close();
});

test('tank bar: width by level, red under warnLaps, yellow when short of the finish, green otherwise', async () => {
  const ov = await loadOverlay('fuel', { settings: { warnLaps: 2 } });
  const bar = () => ov.$('.tank i');
  ov.render(withFuel({ level: 6 })); // 1.5 laps left
  assert.equal(parseFloat(bar().style.width), 6);
  assert.equal(bar().style.background, rgb(THEME.red));
  assert.match(ov.$$('.big b')[1].className, /red/);
  ov.render(withFuel({ level: 20 })); // 5 laps left, 10 to go
  assert.equal(bar().style.background, rgb(THEME.yellow));
  ov.render(withFuel({ level: 60 })); // 15 laps left
  assert.equal(bar().style.background, rgb(THEME.green));
  ov.close();
});

test('tank bar falls back to pct when the tank size is unknown', async () => {
  const ov = await loadOverlay('fuel');
  ov.render(withFuel({ max: 0, pct: 0.42 }));
  assert.equal(parseFloat(ov.$('.tank i').style.width), 42);
  ov.close();
});

test('optional rows follow the settings', async () => {
  const ov = await loadOverlay('fuel', { settings: { showLast: false, showMax: false, showStops: false, showPerHour: true } });
  ov.render(withFuel({ perHour: 37 }));
  const g = grid(ov);
  assert.equal(g['Last lap'], undefined);
  assert.equal(g['Max lap'], undefined);
  assert.equal(g['Stops needed'], undefined);
  assert.equal(g['Per hour'], (37 / 0.74).toFixed(1));
  ov.close();
});

test('imperial units show gallons', async () => {
  const ov = await loadOverlay('fuel');
  ov.render(withFuel({ level: 3.78541 * 4, laps: [3.78541] }, 'imperial'));
  assert.equal(ov.$('.big b').textContent, '4.00');
  assert.equal(ov.$('.big small').textContent, 'gal');
  assert.equal(grid(ov)['Avg / lap'], '1.00');
  ov.close();
});

test('demo race state renders without errors', async () => {
  const ov = await loadOverlay('fuel');
  ov.render(race.state);
  assert.notEqual(ov.$('.big').innerHTML, '');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('missing fuel slice does nothing', async () => {
  const ov = await loadOverlay('fuel');
  ov.renderRaw({ connected: true, session: {} });
  assert.equal(ov.$('.big').innerHTML, '');
  ov.close();
});
