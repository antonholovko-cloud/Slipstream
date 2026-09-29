const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');

const race = demoRace();
const ALL = ['session', 'remain', 'lap', 'position', 'incidents', 'sof', 'track', 'air', 'trackTemp', 'wetness', 'clock', 'simClock'];
const allOn = ALL.map((id) => ({ id, on: true }));
// { label: value } of the rendered items, in order
const items = (ov) => ov.$$('.sess div').map((d) => [d.querySelector('small').textContent, d.querySelector('b').textContent]);

test('default items render from the demo race', async () => {
  const ov = await loadOverlay('session');
  ov.render(race.state);
  const it = items(ov);
  const labels = it.map((x) => x[0]);
  assert.deepEqual(labels, ['Session', 'Laps left', 'Lap', 'Position', 'Incidents', 'SOF', 'Air', 'Track', 'Time']);
  const m = Object.fromEntries(it);
  assert.equal(m.Session, 'RACE');
  assert.equal(m['Laps left'], '17');
  assert.match(m.Lap, /^\d+\/20$/);
  assert.match(m.Position, /^P\d+\/\d+$/);
  assert.equal(m.SOF, '3294');
  assert.equal(m.Air, '24.5°C');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('every item can be shown, in the configured order', async () => {
  const ov = await loadOverlay('session', { settings: { items: allOn.slice().reverse() } });
  ov.render(race.state);
  const labels = items(ov).map((x) => x[0]);
  assert.equal(labels.length, 12);
  assert.equal(labels[0], 'Sim time');
  assert.equal(labels[labels.length - 1], 'Session');
  assert.ok(labels.includes('Surface'));
  ov.close();
});

test('items switched off are not shown', async () => {
  const ov = await loadOverlay('session', { settings: { items: [{ id: 'sof', on: true }, { id: 'session', on: false }] } });
  ov.render(race.state);
  assert.deepEqual(items(ov), [['SOF', '3294']]);
  ov.close();
});

test('remaining: time beats laps, falls back to ∞', async () => {
  const ov = await loadOverlay('session', { settings: { items: [{ id: 'remain', on: true }] } });
  const st = structuredClone(race.state);
  st.session.timeRemain = 3725;
  ov.render(st);
  assert.deepEqual(items(ov), [['Time left', '1:02:05']]);
  st.session.timeRemain = null; st.session.lapsRemain = null;
  ov.render(st);
  assert.deepEqual(items(ov), [['Remaining', '∞']]);
  ov.close();
});

test('incidents turn red at 75% of the limit', async () => {
  const ov = await loadOverlay('session', { settings: { items: [{ id: 'incidents', on: true }] } });
  const st = structuredClone(race.state);
  st.session.incidentLimit = 17;
  st.player.incidents = 12;
  ov.render(st);
  assert.equal(ov.$('b > span').className, '');
  assert.equal(items(ov)[0][1], '12x/17');
  st.player.incidents = 13;
  ov.render(st);
  assert.equal(ov.$('b > span').className, 'red');
  st.session.incidentLimit = 0;
  ov.render(st);
  assert.equal(items(ov)[0][1], '13x');
  ov.close();
});

test('wetness, track name and imperial temperatures', async () => {
  const ov = await loadOverlay('session', { settings: { items: ['track', 'air', 'trackTemp', 'wetness'].map((id) => ({ id, on: true })) } });
  const st = structuredClone(race.state);
  st.session.units = 'imperial';
  st.session.wetness = 5;
  ov.render(st);
  assert.deepEqual(items(ov), [['Track', 'Demo Raceway'], ['Air', '76°F'], ['Track', '101°F'], ['Surface', 'Moderately wet']]);
  ov.close();
});

test('sim time of day in 24h and 12h', async () => {
  const ov = await loadOverlay('session', { settings: { items: [{ id: 'simClock', on: true }], clock24: true } });
  const st = structuredClone(race.state);
  st.session.timeOfDay = 13 * 3600 + 5 * 60;
  ov.render(st);
  assert.deepEqual(items(ov), [['Sim time', '13:05']]);
  ov.configure({ clock24: false });
  ov.render(st);
  assert.deepEqual(items(ov), [['Sim time', '1:05 PM']]);
  st.session.timeOfDay = 0.5 * 3600;
  ov.render(st);
  assert.deepEqual(items(ov), [['Sim time', '12:30 AM']]);
  ov.close();
});

test('position shows a dash without a class position', async () => {
  const ov = await loadOverlay('session', { settings: { items: [{ id: 'position', on: true }, { id: 'lap', on: true }] } });
  const st = structuredClone(race.state);
  st.player.classPosition = 0;
  st.session.lapsTotal = null;
  st.player.lap = -1;
  ov.render(st);
  assert.deepEqual(items(ov), [['Position', '–'], ['Lap', '0']]);
  ov.close();
});
