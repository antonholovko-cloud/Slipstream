const test = require('node:test');
const assert = require('node:assert/strict');
const { TimingTracker } = require('../../src/main/timing');

const DT = 0.05;
/*
 * Simulate cars with constant lap times. cars: [{ idx, lap, start, pitAt?, offAt? }]
 * Returns the tracker state after `seconds`. Player is idx 0.
 */
function drive(tr, cars, { seconds, t0 = 0, playerIdx = 0, classOf, extra = () => ({}) }) {
  let st;
  for (let t = t0; t <= t0 + seconds + 1e-9; t += DT) {
    const pcts = [];
    const pit = [];
    const surf = [];
    let lapCompleted = 0;
    for (const c of cars) {
      const dist = c.start + (t - t0) / c.lap;
      pcts[c.idx] = ((dist % 1) + 1) % 1;
      pit[c.idx] = !!(c.pitAt && c.pitAt(t, dist));
      surf[c.idx] = c.offAt && c.offAt(t, dist) ? 0 : 3;
      if (c.idx === playerIdx) lapCompleted = Math.floor(dist);
    }
    const v = { SessionTime: t, CarIdxLapDistPct: pcts, CarIdxOnPitRoad: pit, CarIdxTrackSurface: surf, PlayerTrackSurface: surf[playerIdx], LapCompleted: lapCompleted, ...extra(t) };
    st = tr.update(v, playerIdx, classOf);
  }
  return st;
}

test('setSectors: reads SplitTimeInfo, adds 0, falls back to thirds', () => {
  const tr = new TimingTracker();
  tr.setSectors({ SplitTimeInfo: { Sectors: [{ SectorStartPct: 0 }, { SectorStartPct: 0.5 }] } });
  assert.deepEqual(tr.starts, [0, 0.5]);
  tr.setSectors({ SplitTimeInfo: { Sectors: [{ SectorStartPct: 0.25 }, { SectorStartPct: 0.75 }] } });
  assert.deepEqual(tr.starts, [0, 0.25, 0.75]);
  tr.setSectors({});
  assert.deepEqual(tr.starts, [0, 1 / 3, 2 / 3]);
  tr.setSectors({ SplitTimeInfo: { Sectors: [{ SectorStartPct: 0 }] } });
  assert.deepEqual(tr.starts, [0, 1 / 3, 2 / 3]);
});

test('setSectors resets timing only when the layout changes', () => {
  const tr = new TimingTracker();
  tr.bestLap = 99;
  tr.setSectors({ SplitTimeInfo: { Sectors: [{ SectorStartPct: 0 }, { SectorStartPct: 1 / 3 }, { SectorStartPct: 2 / 3 }] } });
  assert.equal(tr.bestLap, 99);
  tr.setSectors({ SplitTimeInfo: { Sectors: [{ SectorStartPct: 0 }, { SectorStartPct: 0.5 }] } });
  assert.equal(tr.bestLap, null);
});

test('sectorOf', () => {
  const tr = new TimingTracker();
  assert.equal(tr.sectorOf(0), 0);
  assert.equal(tr.sectorOf(0.4), 1);
  assert.equal(tr.sectorOf(0.99), 2);
});

test('times sectors and laps from line crossings (interpolated)', () => {
  const tr = new TimingTracker();
  // 30 s laps, starting just after the line: first lap is untimed (started mid-lap)
  const st = drive(tr, [{ idx: 0, lap: 30, start: 0.9 }], { seconds: 3 + 30 * 2 + 1 });
  assert.equal(st.log.length, 2);
  for (const e of st.log) {
    assert.ok(Math.abs(e.time - 30) < 1e-6, `lap ${e.time}`);
    e.sectors.forEach((s) => assert.ok(Math.abs(s - 10) < 1e-6));
    assert.equal(e.off, false);
    assert.equal(e.pit, false);
  }
  assert.ok(Math.abs(st.optimal - 30) < 1e-6);
  assert.equal(st.personalBest.length, 3);
  assert.equal(st.current.timed, true);
  assert.equal(st.current.sector, 0);
  assert.ok(st.current.lapRunning >= 0 && st.current.lapRunning < 2);
});

test('lap numbers never repeat and follow LapCompleted', () => {
  const tr = new TimingTracker();
  const st = drive(tr, [{ idx: 0, lap: 20, start: 0.95 }], { seconds: 1 + 20 * 3 + 1 });
  const laps = st.log.map((e) => e.lap);
  assert.deepEqual(laps, [...new Set(laps)]);
  for (let i = 1; i < laps.length; i++) assert.ok(laps[i] > laps[i - 1]);
});

test('off-track laps are logged but never count as best; pit laps neither', () => {
  const tr = new TimingTracker();
  // lap 2 (dist 1..2) is off track, and faster sectors can't come from it
  const st = drive(tr, [{ idx: 0, lap: 30, start: 0.95, offAt: (t, d) => d > 1.5 && d < 1.6 }], { seconds: 1.5 + 30 * 3 });
  const off = st.log.filter((e) => e.off);
  assert.equal(off.length, 1);
  assert.ok(st.log.some((e) => !e.off));
  const tr2 = new TimingTracker();
  const st2 = drive(tr2, [{ idx: 0, lap: 30, start: 0.95, pitAt: (t, d) => d > 1.2 && d < 1.3 }], { seconds: 1.5 + 30 * 2 });
  assert.ok(st2.log.some((e) => e.pit));
});

// BUG (src/main/timing.js:134,136): bestLap starts as null and `!(null <= time)` is false,
// so our own best lap and best-lap trace are never recorded until iRacing's official lap time
// sets bestLap. Expected: the first clean timed lap becomes the best lap.
test('first clean timed lap becomes our best lap (and best trace)', () => {
  const tr = new TimingTracker();
  const st = drive(tr, [{ idx: 0, lap: 30, start: 0.95 }], { seconds: 1.5 + 30 * 2 });
  assert.ok(Math.abs(st.bestLap - 30) < 1e-6);
  assert.ok(tr.bestTrace);
});

test('off/pit laps never become the best lap once a best exists', () => {
  const tr = new TimingTracker();
  tr.bestLap = 40; // e.g. set from an official lap time
  const st = drive(tr, [{ idx: 0, lap: 30, start: 0.95, offAt: (t, d) => d > 1.5 && d < 1.6 }], { seconds: 1.5 + 30 });
  assert.ok(st.log.every((e) => e.off));
  assert.equal(st.bestLap, 40);
  const p0 = tr.cars.get(0).pct;
  drive(tr, [{ idx: 0, lap: 30, start: p0 }], { seconds: 31, t0: 31.6 });
  assert.ok(Math.abs(tr.bestLap - 30.1) < 0.01, 'a clean faster lap replaces it (30 s + the 0.1 s pause between drives)');
  assert.ok(tr.bestTrace, 'and becomes the best trace');
});

test('session best sectors are kept per class', () => {
  const tr = new TimingTracker();
  const classOf = (i) => (i === 1 ? 'fast' : 'slow');
  const st = drive(tr, [{ idx: 0, lap: 30, start: 0.95 }, { idx: 1, lap: 15, start: 0.95 }], { seconds: 1.5 + 30 * 2, classOf });
  st.sessionBest.forEach((s) => assert.ok(Math.abs(s - 10) < 1e-6, 'player sees own class bests'));
  const fast = tr.sessionBest.get('fast');
  fast.forEach((s) => assert.ok(Math.abs(s - 5) < 1e-6));
});

test('a teleport / tow discards the lap in progress', () => {
  const tr = new TimingTracker();
  drive(tr, [{ idx: 0, lap: 30, start: 0.95 }], { seconds: 10 });
  assert.notEqual(tr.cars.get(0).lapStart, null);
  tr.update({ SessionTime: 10.1, CarIdxLapDistPct: [0.9] }, 0);
  assert.equal(tr.cars.get(0).lapStart, null);
  assert.deepEqual(tr.cars.get(0).times, []);
  tr.update({ SessionTime: 10.15, CarIdxLapDistPct: [0.901] }, 0);
  assert.equal(tr.trace, null, 'no trace while the lap is untimed');
});

test('cars leaving the world are forgotten', () => {
  const tr = new TimingTracker();
  tr.update({ SessionTime: 0, CarIdxLapDistPct: [0.1, 0.2] }, 0);
  assert.equal(tr.cars.size, 2);
  tr.update({ SessionTime: 0.05, CarIdxLapDistPct: [0.101, -1] }, 0);
  assert.equal(tr.cars.has(1), false);
});

test('prefers iRacing\'s official lap time when it arrives shortly after', () => {
  const tr = new TimingTracker();
  drive(tr, [{ idx: 0, lap: 30, start: 0.95 }], { seconds: 1.5 + 30 });
  const last = tr.log[tr.log.length - 1];
  assert.equal(last.official, false);
  tr.update({ SessionTime: last.at + 1, CarIdxLapDistPct: [], LapLastLapTime: 29.95, LapCompleted: 7 }, 0);
  assert.equal(last.time, 29.95);
  assert.equal(last.official, true);
  assert.equal(last.lap, 7);
  assert.equal(tr.bestLap, 29.95);
  // a very different official time is ignored
  const tr2 = new TimingTracker();
  drive(tr2, [{ idx: 0, lap: 30, start: 0.95 }], { seconds: 1.5 + 30 });
  const l2 = tr2.log[tr2.log.length - 1];
  tr2.update({ SessionTime: l2.at + 1, CarIdxLapDistPct: [], LapLastLapTime: 35 }, 0);
  assert.equal(l2.official, false);
});

test('fuel used per lap is logged', () => {
  const tr = new TimingTracker();
  const st = drive(tr, [{ idx: 0, lap: 30, start: 0.95 }], { seconds: 1.5 + 30 * 2, extra: (t) => ({ FuelLevel: 50 - t * 0.1 }) });
  const e = st.log[st.log.length - 1];
  assert.ok(Math.abs(e.fuel - 3) < 0.01, `fuel ${e.fuel}`);
});

test('own delta: none without a reference lap, then time vs best / last trace', () => {
  const tr = new TimingTracker();
  assert.deepEqual(tr.delta('best', 0, 0), [0, 0, false]);
  tr.bestLap = 999; // work around the null-bestLap bug above so the first lap becomes the best trace
  // one clean 30 s lap as reference, then a slower 33 s lap
  drive(tr, [{ idx: 0, lap: 30, start: 0.95 }], { seconds: 1.5 + 30 });
  const t0 = 1.5 + 30;
  const slow = { idx: 0, lap: 33, start: tr.cars.get(0).pct };
  drive(tr, [slow], { seconds: 16.5, t0: t0 + DT });
  const [d, , ok] = tr.delta('best', t0 + DT + 16.5, 0);
  assert.equal(ok, true);
  assert.ok(d > 1 && d < 2, `delta ${d}`); // half a lap at +10% -> ~1.5 s down
  const [dl, , okl] = tr.delta('last', t0 + DT + 16.5, 0);
  assert.equal(okl, true);
  assert.ok(Math.abs(dl - d) < 1e-9, 'last lap = best lap here');
  // rate: after 0.2 s more, delta keeps growing at ~ +0.1 s/s
  const later = t0 + DT + 16.5 + DT + 0.2;
  drive(tr, [{ ...slow, start: tr.cars.get(0).pct }], { seconds: 0.2, t0: t0 + DT + 16.5 + DT });
  const [, rate] = tr.delta('best', later, 0);
  assert.ok(rate > 0.05 && rate < 0.3, `rate ${rate}`); // ~0.1 s/s plus the one paused frame between drives
});

test('state without a player car', () => {
  const tr = new TimingTracker();
  const st = tr.update({ SessionTime: 0, CarIdxLapDistPct: [] }, 5);
  assert.equal(st.current, null);
  assert.equal(st.optimal, null);
  assert.deepEqual(st.log, []);
});
