const test = require('node:test');
const assert = require('node:assert/strict');
const { MockSource } = require('../../src/main/mock');

test('session info: 22 drivers + a pace car, two classes, sectors, a race session', () => {
  const m = new MockSource();
  const di = m.sessionInfo.DriverInfo;
  assert.equal(di.Drivers.length, 23);
  assert.equal(di.Drivers.filter((d) => d.CarIsPaceCar).length, 1);
  assert.deepEqual([...new Set(di.Drivers.filter((d) => !d.CarIsPaceCar).map((d) => d.CarClassShortName))].sort(), ['GT3', 'LMP2']);
  assert.equal(di.DriverCarIdx, m.playerIdx);
  assert.equal(di.Drivers[m.playerIdx].UserName, 'You Driver');
  assert.equal(m.sessionInfo.SessionInfo.Sessions[0].SessionType, 'Race');
  assert.equal(m.sessionInfo.SplitTimeInfo.Sectors[0].SectorStartPct, 0);
  assert.ok(m.sessionInfo.SplitTimeInfo.Sectors.length >= 2);
});

test('the grid and drivers are deterministic', () => {
  const a = new MockSource(), b = new MockSource();
  assert.deepEqual(a.sessionInfo.DriverInfo.Drivers, b.sessionInfo.DriverInfo.Drivers);
  const fa = a.step(0.05), fb = b.step(0.05);
  assert.deepEqual(fa.vars.CarIdxLapDistPct, fb.vars.CarIdxLapDistPct);
  assert.deepEqual(fa.vars.CarIdxPosition, fb.vars.CarIdxPosition);
});

test('frames have the iRacing reader shape', () => {
  const f = new MockSource().step(0.05);
  assert.equal(f.sessionInfoUpdate, 1);
  assert.equal(f.tickRate, 60);
  assert.equal(f.demoTrack.id, 'demo-grand-prix');
  assert.ok(f.demoTrack.points.length > 100);
  for (const k of ['SessionTime', 'PlayerCarIdx', 'Speed', 'RPM', 'Gear', 'Throttle', 'Brake', 'FuelLevel', 'CarIdxLapDistPct', 'CarIdxEstTime', 'SessionFlags', 'CarLeftRight']) {
    assert.ok(k in f.vars, k);
  }
  assert.equal(f.vars.CarIdxLapDistPct.length, 64);
  assert.equal(f.vars.CarIdxLapDistPct[0], -1, 'pace car is not in the world');
});

test('fastForward advances sim time in 1/20 s steps and calls back per frame', () => {
  const m = new MockSource();
  let n = 0;
  m.fastForward(10, () => n++);
  assert.equal(n, 200);
  assert.ok(Math.abs(m.sessionTime - 10) < 1e-6);
});

test('positions are a permutation 1..22 and class positions restart per class', () => {
  const m = new MockSource();
  let f;
  m.fastForward(60, (x) => { f = x; });
  const cars = m.cars.filter((c) => !c.pace);
  const pos = cars.map((c) => f.vars.CarIdxPosition[c.idx]).sort((a, b) => a - b);
  assert.deepEqual(pos, cars.map((_, i) => i + 1));
  for (const cls of ['GT3', 'LMP2']) {
    const cp = cars.filter((c) => c.cls.short === cls).map((c) => f.vars.CarIdxClassPosition[c.idx]).sort((a, b) => a - b);
    assert.deepEqual(cp, cp.map((_, i) => i + 1));
  }
});

test('pinned cars stay at a fixed distance from the player', () => {
  const m = new MockSource();
  m.fastForward(30);
  m.pinned = [{ idx: 12, meters: 20 }];
  let f;
  m.fastForward(5, (x) => { f = x; });
  let d = f.vars.CarIdxLapDistPct[12] - f.vars.CarIdxLapDistPct[m.playerIdx];
  if (d < -0.5) d += 1;
  assert.ok(Math.abs(d * 4200 - 20) < 10, `${d * 4200} m`);
});

test('gearbox: rpm follows road speed within a gear; laps complete and set lap times', () => {
  const m = new MockSource();
  const seen = new Set();
  let f;
  m.fastForward(200, (x) => { f = x; seen.add(x.vars.Gear); });
  assert.ok(seen.size >= 4, [...seen].join());
  assert.ok(f.vars.RPM >= 900 && f.vars.RPM < 11000);
  assert.ok(m.cars[m.playerIdx].lastLap > 30);
  assert.ok(f.vars.LapBestLapTime > 0);
  assert.ok(f.vars.FuelLevel < 42);
});

test('flag override and script hook', () => {
  const m = new MockSource();
  m.flagOverride = 0x8;
  m.script = (v) => { v.Throttle = 0.123; };
  const f = m.step(0.05);
  assert.equal(f.vars.SessionFlags, 0x8);
  assert.equal(f.vars.Throttle, 0.123);
});

test('read() steps by wall-clock time and returns null when no time passed', () => {
  const m = new MockSource();
  m.last = Date.now() + 1000; // in the future -> dt <= 0
  assert.equal(m.read(), null);
  m.last = Date.now() - 50;
  const f = m.read();
  assert.ok(f && f.vars.SessionTime > 0 && f.vars.SessionTime <= 0.1);
});
