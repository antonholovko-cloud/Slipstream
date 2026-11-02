const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LapStats, summarize } = require('../../src/main/stats');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-stats-')), 'lap-stats.json');
function store(file = tmpFile()) {
  const s = new LapStats(file);
  s.save = () => s.saveNow(); // no debounce timers left behind in tests
  return s;
}
const lap = (at, time, extra = {}) => ({ lap: at, time, at, off: false, pit: false, ...extra });
function state(log, over = {}) {
  return {
    session: {
      track: { id: '7-GP', name: 'Test Ring', config: 'GP' }, car: { id: 'bmwm4gt3', name: 'BMW M4 GT3' },
      type: 'Practice', name: 'PRACTICE', kind: 'practice', airTemp: 22, trackTemp: 31, wetness: 1, skies: 0, replay: false, ...over,
    },
    timing: { log },
  };
}

test('a session is stored once it has a lap, with track, car, date and conditions', () => {
  const s = store();
  const model = { sessionKey: '1/2/0' };
  s.update(model, state([]), 1000);
  assert.equal(s.list().length, 0, 'no laps: nothing stored');
  s.update(model, state([lap(1, 90.5)]), 2000);
  const [r] = s.list();
  assert.equal(r.date, 1000, 'the date is when the session started');
  assert.deepEqual(r.track, { id: '7-GP', name: 'Test Ring', config: 'GP' });
  assert.deepEqual(r.car, { id: 'bmwm4gt3', name: 'BMW M4 GT3' });
  assert.equal(r.type, 'Practice');
  assert.deepEqual(r.conditions, { air: 22, trk: 31, wetness: 1, skies: 0 });
  assert.deepEqual(r.laps, [{ lap: 1, time: 90.5, off: false, pit: false, air: 22, trk: 31 }]);
});

test('fastest and average count clean laps only', () => {
  const sm = summarize({ laps: [{ time: 95, pit: true }, { time: 90 }, { time: 92 }, { time: 89, off: true }, { time: 91, air: 20, trk: 30 }, { time: 94, air: 21, trk: 33 }] });
  assert.equal(sm.laps, 6);
  assert.equal(sm.clean, 4);
  assert.equal(sm.fastest, 90);
  assert.equal(sm.avg, (90 + 92 + 91 + 94) / 4);
  assert.deepEqual(sm.air, [20, 21]);
  assert.deepEqual(sm.trk, [30, 33]);
  assert.deepEqual(summarize({ laps: [{ time: 80, off: true }] }), { laps: 1, clean: 0, fastest: null, avg: null, air: null, trk: null });
});

test("iRacing's official time updates the lap already stored, not a new one", () => {
  const s = store();
  const model = { sessionKey: 'k' };
  const e = lap(1, 90.512);
  s.update(model, state([e]));
  e.time = 90.5;
  s.update(model, state([e]));
  assert.deepEqual(s.list()[0].laps.map((l) => l.time), [90.5]);
});

test('a new session, a reconnect (new model) or another car start a new record; replays are ignored', () => {
  const s = store();
  const m1 = { sessionKey: 'a' };
  s.update(m1, state([lap(1, 90)]));
  s.update(m1, state([lap(1, 90), lap(2, 89)]));
  s.update({ sessionKey: 'a' }, state([lap(1, 88)])); // reconnect: same key, new model
  const m3 = { sessionKey: 'b' };
  s.update(m3, state([lap(1, 87)], { replay: true }));
  s.update(m3, state([lap(1, 86)], { car: { id: 'porsche', name: 'Porsche 911 GT3 R' } }));
  const list = s.list();
  assert.deepEqual(list.map((r) => r.laps.map((l) => l.time)), [[86], [88], [90, 89]], 'newest first');
  assert.equal(list[0].car.name, 'Porsche 911 GT3 R');
});

test('saved to disk and loaded back; sessions can be deleted', () => {
  const file = tmpFile();
  const s = store(file);
  s.update({ sessionKey: 'a' }, state([lap(1, 90)]));
  s.update({ sessionKey: 'b' }, state([lap(1, 91)]));
  const again = store(file);
  assert.equal(again.list().length, 2);
  again.remove(again.list()[0].id);
  assert.deepEqual(store(file).list().map((r) => r.summary.fastest), [90]);
  again.remove('*');
  assert.equal(store(file).list().length, 0);
});

test('a broken file starts empty instead of failing', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not json');
  const e = console.error; console.error = () => {};
  try { assert.deepEqual(store(file).list(), []); } finally { console.error = e; }
});
