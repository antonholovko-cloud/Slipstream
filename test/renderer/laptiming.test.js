const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');

const race = demoRace();

function timing(patch = {}) {
  return {
    starts: [0, 0.33, 0.66],
    current: { sector: 1, times: [23.4], running: 5.23, lapRunning: 28.63, timed: true },
    personalBest: [23.5, 23.6, 23.7],
    sessionBest: [23.4, 23.5, 23.6],
    bestLap: 70.8,
    optimal: 70.5,
    log: [
      { lap: 2, time: 70.8, sectors: [23.5, 23.6, 23.7], off: false, pit: false, fuel: 4.4 },
      { lap: 3, time: 71.1, sectors: [23.4, 23.9, 23.8], off: false, pit: false, fuel: 4.5 },
      { lap: 4, time: 75.0, sectors: [24.0, 25.0, 26.0], off: true, pit: false, fuel: 4.6 },
      { lap: 5, time: 90.0, sectors: [23.3, 33.0, 33.7], off: false, pit: true, fuel: 3.0 },
    ],
    ...patch,
  };
}
const withTiming = (patch) => ({ ...structuredClone(race.state), timing: timing(patch) });
const boxes = (ov) => ov.$$('.cur .box').map((b) => ({ cls: b.className.replace('box', '').trim(), label: b.querySelector('small').textContent, val: b.querySelector('b').textContent }));
const logRows = (ov) => ov.$$('.logwrap tr').slice(1);

test('current lap: running lap time, done sectors colored, active sector running', async () => {
  const ov = await loadOverlay('laptiming');
  ov.render(withTiming());
  assert.deepEqual(boxes(ov), [
    { cls: 'lap', label: 'Lap', val: '28.6' },
    { cls: 'purple', label: 'S1', val: '23.400' },
    { cls: 'active', label: 'S2', val: '5.2' },
    { cls: '', label: 'S3', val: '–' },
  ]);
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('sector colors: purple = session best, green = personal best, yellow = slower', async () => {
  const ov = await loadOverlay('laptiming');
  const cur = (t) => withTiming({ current: { sector: 2, times: t, running: 1, lapRunning: 50, timed: true } });
  ov.render(cur([23.45, 23.55]));
  assert.deepEqual(boxes(ov).slice(1, 3).map((b) => b.cls), ['green', 'green']);
  ov.render(cur([23.6, 23.5]));
  assert.deepEqual(boxes(ov).slice(1, 3).map((b) => b.cls), ['yellow', 'purple']);
  ov.close();
});

test('colorSectors off: no colors', async () => {
  const ov = await loadOverlay('laptiming', { settings: { colorSectors: false } });
  ov.render(withTiming());
  assert.equal(boxes(ov)[1].cls, '');
  assert.ok(logRows(ov).every((r) => ![...r.children].slice(2).some((td) => /purple|yellow/.test(td.className))));
  ov.close();
});

test('untimed lap (out lap): dashes', async () => {
  const ov = await loadOverlay('laptiming');
  ov.render(withTiming({ current: { sector: 0, times: [], running: null, lapRunning: 0, timed: false } }));
  assert.deepEqual(boxes(ov).map((b) => b.val), ['–', '–', '–', '–']);
  ov.close();
});

test('summary row and header: last, best, optimal', async () => {
  const ov = await loadOverlay('laptiming');
  ov.render(withTiming());
  const sum = ov.$('.sum').textContent;
  assert.match(sum, /Last 1:30\.000/);
  assert.match(sum, /Best 1:10\.800/);
  assert.match(sum, /Optimal 1:10\.500/);
  assert.equal(ov.headerRight(), 'Optimal 1:10.500');
  ov.close();
});

test('lap log: newest first, delta to best, OFF / PIT flags dimmed, best lap green', async () => {
  const ov = await loadOverlay('laptiming');
  ov.render(withTiming());
  const head = [...ov.$$('.logwrap tr')[0].children].map((th) => th.textContent);
  assert.deepEqual(head, ['Lap', 'Time', 'Δ', 'S1', 'S2', 'S3', 'L']);
  const rows = logRows(ov);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.firstElementChild.textContent), ['5PIT', '4OFF', '3', '2']);
  assert.ok(rows[0].classList.contains('bad'));
  assert.ok(rows[1].classList.contains('bad'));
  const best = rows[3];
  assert.equal(best.children[1].className, 'green');
  assert.equal(best.children[2].textContent, '–');
  assert.equal(rows[2].children[2].textContent, '+0.30');
  // bad laps get no sector colors
  assert.ok([...rows[0].children].slice(3, 6).every((td) => td.className === ''));
  assert.equal(rows[2].children[3].className, 'purple');
  assert.equal(rows[2].children[4].className, 'yellow');
  assert.equal(rows[3].lastElementChild.textContent, '4.40');
  ov.close();
});

test('log columns and row count follow the settings', async () => {
  const ov = await loadOverlay('laptiming', { settings: { logRows: 2, logSectors: false, logDelta: false, logFuel: false } });
  ov.render(withTiming());
  const head = [...ov.$$('.logwrap tr')[0].children].map((th) => th.textContent);
  assert.deepEqual(head, ['Lap', 'Time']);
  assert.equal(logRows(ov).length, 2);
  ov.close();
});

test('empty log shows a hint', async () => {
  const ov = await loadOverlay('laptiming');
  ov.render(withTiming({ log: [], bestLap: null, optimal: null }));
  assert.match(ov.$('.logwrap').textContent, /Complete a lap to start the log/);
  assert.match(ov.$('.sum').textContent, /Last –.*Best –.*Optimal –/);
  assert.equal(ov.headerRight(), '');
  ov.close();
});

test('decimals setting', async () => {
  const ov = await loadOverlay('laptiming', { settings: { decimals: 1 } });
  ov.render(withTiming());
  assert.equal(boxes(ov)[1].val, '23.4');
  assert.match(ov.$('.sum').textContent, /Best 1:10\.8/);
  ov.close();
});

test('many sectors switch to the compact layout', async () => {
  const ov = await loadOverlay('laptiming');
  const starts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  ov.render(withTiming({ starts, current: { sector: 0, times: [], running: 1, lapRunning: 1, timed: true }, log: [] }));
  assert.ok(ov.$('.cur').classList.contains('many'));
  assert.equal(ov.$$('.cur .box').length, 11);
  ov.close();
});

test('sections can be hidden', async () => {
  const ov = await loadOverlay('laptiming', { settings: { showCurrent: false, showSummary: false, showLog: false } });
  ov.render(withTiming());
  for (const sel of ['.cur', '.sum', '.logwrap']) assert.equal(ov.$(sel).style.display, 'none');
  ov.close();
});

test('imperial fuel column in gallons', async () => {
  const ov = await loadOverlay('laptiming');
  const st = withTiming({ log: [{ lap: 2, time: 70.8, sectors: [23.5, 23.6, 23.7], off: false, pit: false, fuel: 3.78541 }] });
  st.session.units = 'imperial';
  ov.render(st);
  assert.equal(ov.$$('.logwrap tr')[0].lastElementChild.textContent, 'gal');
  assert.equal(logRows(ov)[0].lastElementChild.textContent, '1.00');
  ov.close();
});

test('demo race timing renders without errors; no timing slice is ignored', async () => {
  const ov = await loadOverlay('laptiming');
  ov.render(race.state);
  assert.equal(ov.$$('.cur .box').length, race.state.timing.starts.length + 1);
  ov.renderRaw({ connected: true });
  assert.deepEqual(ov.errors, []);
  ov.close();
});
