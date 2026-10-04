const test = require('node:test');
const assert = require('node:assert/strict');
const { RaceModel, iratingDeltas, hexColor } = require('../../src/main/model');
const { demoRace } = require('../helpers/demo');

// ---------- synthetic sessions ----------
const GT3 = { id: 2708, short: 'GT3', color: 0xffda59, est: 100 };
const LMP2 = { id: 4029, short: 'LMP2', color: 0x33ceff, est: 90 };

function driver(idx, cls, over = {}) {
  return {
    CarIdx: idx, UserName: `Driver ${idx}`, AbbrevName: `D, ${idx}`, Initials: 'DD', UserID: 1000 + idx, TeamName: `Team ${idx}`,
    CarNumber: String(idx), CarClassID: cls.id, CarClassShortName: cls.short, CarClassColor: cls.color, CarClassEstLapTime: cls.est,
    CarScreenNameShort: cls.short + ' car', IRating: 2000, LicString: 'A 3.00', LicColor: 0x0153db, IsSpectator: 0, CarIsPaceCar: 0, ...over,
  };
}

function sessionInfo({ drivers, player = 1, type = 'Race', league = 0, trackLength = '4.00 km', incidentLimit = 17, results = null, laps = 20 }) {
  return {
    WeekendInfo: { TrackID: 7, TrackName: 'test', TrackDisplayName: 'Test Ring', TrackConfigName: 'GP', TrackLength: trackLength, LeagueID: league, WeekendOptions: { IncidentLimit: incidentLimit } },
    SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: type, SessionName: type.toUpperCase(), SessionLaps: laps, ResultsPositions: results }] },
    DriverInfo: { DriverCarIdx: player, DriverCarFuelMaxLtr: 100, DriverCarMaxFuelPct: 1, DriverCarEstLapTime: 100, DriverCarRedLine: 8000, Drivers: drivers },
  };
}

// cars: { [idx]: { pct, lap, pos, cpos, pit, surf, est, last, best, f2 } }
function vars(cars, extra = {}) {
  const n = 64;
  const a = (v) => new Array(n).fill(v);
  const v = {
    SessionTime: 100, SessionNum: 0, SessionState: 4, SessionFlags: 0x4, SessionTimeRemain: 604800, SessionLapsRemainEx: 10, SessionTimeTotal: 604800,
    PlayerCarIdx: 1, IsOnTrack: true, OnPitRoad: false, DisplayUnits: 1, FuelLevel: 50, IsReplayPlaying: false, CamCarIdx: 1,
    CarIdxLapDistPct: a(-1), CarIdxLapCompleted: a(-1), CarIdxLap: a(-1), CarIdxPosition: a(0), CarIdxClassPosition: a(0), CarIdxOnPitRoad: a(false),
    CarIdxTrackSurface: a(-1), CarIdxEstTime: a(0), CarIdxLastLapTime: a(-1), CarIdxBestLapTime: a(-1), CarIdxF2Time: a(0), CarIdxTireCompound: a(0),
  };
  for (const [idx, c] of Object.entries(cars)) {
    v.CarIdxLapDistPct[idx] = c.pct ?? 0;
    v.CarIdxLapCompleted[idx] = c.lap ?? 0;
    v.CarIdxLap[idx] = (c.lap ?? 0) + 1;
    v.CarIdxPosition[idx] = c.pos ?? 0;
    v.CarIdxClassPosition[idx] = c.cpos ?? 0;
    v.CarIdxOnPitRoad[idx] = !!c.pit;
    v.CarIdxTrackSurface[idx] = c.surf ?? 3;
    v.CarIdxEstTime[idx] = c.est ?? 0;
    v.CarIdxLastLapTime[idx] = c.last ?? -1;
    v.CarIdxBestLapTime[idx] = c.best ?? -1;
    v.CarIdxF2Time[idx] = c.f2 ?? 0;
  }
  return Object.assign(v, extra);
}

const frame = (info, v, siu = 1) => ({ vars: v, sessionInfo: info, sessionInfoUpdate: siu });
const G = (over = {}) => ({ units: 'metric', speedUnit: 'auto', focusCamCar: true, classSplits: [], ...over });
const byIdx = (st, idx) => st.cars.find((c) => c.idx === idx);

// ---------- pure helpers ----------
test('hexColor: numbers, hex strings, fallbacks', () => {
  assert.equal(hexColor(0xffda59), '#ffda59');
  assert.equal(hexColor(0x1ffda59), '#ffda59', 'masked to 24 bits');
  assert.equal(hexColor('0x33ceff'), '#33ceff');
  assert.equal(hexColor('#00ff00'), '#00ff00');
  assert.equal(hexColor(''), '#ffffff');
  assert.equal(hexColor(null, '#888888'), '#888888');
  assert.equal(hexColor('zzz', '#123456'), '#123456');
  assert.equal(hexColor(0), '#000000');
});

test('iratingDeltas: winner gains, last loses, n<2 = 0, symmetric for an equal field', () => {
  assert.deepEqual(iratingDeltas([{ ir: 2000, pos: 1 }]), [0]);
  const eq = iratingDeltas([1, 2, 3, 4].map((pos) => ({ ir: 2000, pos })));
  assert.ok(eq[0] > 0 && eq[3] < 0);
  assert.ok(eq[0] > eq[1] && eq[1] > eq[2] && eq[2] > eq[3]);
  assert.ok(Math.abs(eq[0] + eq[3]) <= 1 && Math.abs(eq[1] + eq[2]) <= 1, JSON.stringify(eq));
  // beating much higher-rated drivers pays more
  const upset = iratingDeltas([{ ir: 1000, pos: 1 }, { ir: 4000, pos: 2 }]);
  const expected = iratingDeltas([{ ir: 4000, pos: 1 }, { ir: 1000, pos: 2 }]);
  assert.ok(upset[0] > expected[0]);
});

// ---------- parseInfo / basics ----------
test('returns null until session info arrives', () => {
  const m = new RaceModel();
  assert.equal(m.update({ vars: vars({}), sessionInfo: null, sessionInfoUpdate: 0 }, G()), null);
});

test('parseInfo: drivers, track length (km / mi), incident limit, car data; pace car & spectators excluded', () => {
  const m = new RaceModel();
  const drivers = [driver(0, GT3, { CarIsPaceCar: 1 }), driver(1, GT3), driver(2, GT3, { IsSpectator: 1 }), driver(3, LMP2)];
  let st = m.update(frame(sessionInfo({ drivers }), vars({ 1: { pct: 0.5, pos: 2 }, 3: { pct: 0.6, pos: 1 } })), G());
  assert.deepEqual(st.cars.map((c) => c.idx).sort(), [1, 3]);
  assert.equal(m.track.length, 4000);
  assert.equal(st.session.track.name, 'Test Ring');
  assert.equal(st.session.incidentLimit, 17);
  assert.equal(byIdx(st, 1).classColor, '#ffda59');
  assert.equal(byIdx(st, 1).className, 'GT3');
  assert.equal(m.car.fuelMax, 100);
  const m2 = new RaceModel();
  m2.update(frame(sessionInfo({ drivers, trackLength: '2.50 mi', incidentLimit: 'unlimited' }), vars({ 1: {} })), G());
  assert.ok(Math.abs(m2.track.length - 2.5 * 1609.34) < 0.01);
  assert.equal(m2.incidentLimit, 0);
});

test('session kind, isRace and speed units', () => {
  const drivers = [driver(1, GT3)];
  const kind = (type) => new RaceModel().update(frame(sessionInfo({ drivers, type }), vars({ 1: {} })), G()).session;
  assert.equal(kind('Race').kind, 'race');
  assert.equal(kind('Race').isRace, true);
  assert.equal(kind('Lone Qualify').kind, 'qualify');
  assert.equal(kind('Open Practice').kind, 'practice');
  assert.equal(kind('Warmup').kind, 'practice');
  const su = (g, extra) => new RaceModel().update(frame(sessionInfo({ drivers }), vars({ 1: {} }, extra)), G(g)).session;
  assert.equal(su({ units: 'auto' }, { DisplayUnits: 0 }).units, 'imperial');
  assert.equal(su({ units: 'auto' }, { DisplayUnits: 1 }).units, 'metric');
  assert.equal(su({ units: 'metric', speedUnit: 'mph' }).speedUnits, 'imperial');
  assert.equal(su({ units: 'imperial', speedUnit: 'kmh' }).speedUnits, 'metric');
  assert.equal(su({ units: 'imperial', speedUnit: 'auto' }).speedUnits, 'imperial');
});

// ---------- positions / classes ----------
test('positions: live first, then session results, then best lap', () => {
  const drivers = [driver(1, GT3), driver(2, GT3), driver(3, GT3), driver(4, GT3)];
  const results = [{ CarIdx: 3, Position: 1, ClassPosition: 0, FastestTime: 99.5, LastTime: 100.1, LapsComplete: 5 }];
  const m = new RaceModel();
  const st = m.update(frame(sessionInfo({ drivers, type: 'Practice', results }), vars({
    1: { pos: 2, cpos: 2, pct: 0.1 }, 2: { pct: 0.2, best: 101 }, 3: { pct: -1, lap: -1 }, 4: { pct: 0.3, best: 100.5 },
  })), G());
  assert.equal(byIdx(st, 1).position, 2);
  const c3 = byIdx(st, 3);
  assert.equal(c3.position, 1);
  assert.equal(c3.classPosition, 1);
  assert.equal(c3.bestLap, 99.5);
  assert.equal(c3.lastLap, 100.1);
  assert.equal(c3.lapCompleted, 5);
  assert.equal(c3.inWorld, false);
  // cars without any position get class positions from their best lap
  assert.equal(byIdx(st, 4).classPosition, 3);
  assert.equal(byIdx(st, 2).classPosition, 4);
});

test('classes: SOF, counts, faster class first, fastest lap flag', () => {
  const drivers = [driver(1, GT3, { IRating: 2000 }), driver(2, GT3, { IRating: 2000 }), driver(3, LMP2, { IRating: 3000 }), driver(4, LMP2, { IRating: 1000 })];
  const st = new RaceModel().update(frame(sessionInfo({ drivers, type: 'Practice' }), vars({
    1: { pos: 3, cpos: 1, best: 100 }, 2: { pos: 4, cpos: 2, best: 101 }, 3: { pos: 1, cpos: 1, best: 90 }, 4: { pos: 2, cpos: 2, best: 91 },
  })), G());
  assert.deepEqual(st.classes.map((k) => k.name), ['LMP2', 'GT3']);
  const gt3 = st.classes.find((k) => k.name === 'GT3');
  assert.equal(gt3.count, 2);
  assert.equal(gt3.sof, 2000, 'equal ratings -> SOF equals the rating');
  const lmp2 = st.classes.find((k) => k.name === 'LMP2');
  assert.ok(lmp2.sof > 1000 && lmp2.sof < 3000);
  assert.equal(gt3.bestLap, 100);
  assert.equal(byIdx(st, 1).fastest, true);
  assert.equal(byIdx(st, 2).fastest, false);
  // practice: gap = best lap difference within class
  assert.equal(byIdx(st, 2).gap, 1);
  assert.equal(byIdx(st, 2).interval, 1);
  assert.equal(st.player.classCount, 2);
  assert.equal(st.session.sof, 2000);
});

test('race gaps: leader 0, gaps grow down the order, interval = gap to car ahead, laps down', () => {
  const { state } = demoRace({ seconds: 300 });
  assert.equal(state.session.isRace, true);
  for (const k of state.classes) {
    const cars = state.cars.filter((c) => c.classId === k.id).sort((a, b) => a.classPosition - b.classPosition);
    assert.deepEqual(cars.map((c) => c.classPosition), cars.map((_, i) => i + 1));
    assert.equal(cars[0].gap, 0);
    assert.equal(cars[0].interval, null);
    for (let i = 1; i < cars.length; i++) {
      assert.ok(cars[i].gap >= cars[i - 1].gap - 0.05, `${k.name} P${i + 1} gap ${cars[i].gap} < ${cars[i - 1].gap}`);
      assert.ok(cars[i].interval >= 0);
      assert.ok(cars[i].lapsDown >= 0);
    }
    assert.ok(cars.every((c) => Number.isInteger(c.irDelta)));
  }
});

test('live running order: the car physically ahead / behind, even while iRacing positions lag', () => {
  // just after a spin: #4 went past (and #5 is towing), but iRacing still has the old order until the line
  const drivers = [driver(1, GT3), driver(2, GT3), driver(3, GT3), driver(4, GT3), driver(5, GT3), driver(6, LMP2)];
  const m = new RaceModel();
  const st = m.update(frame(sessionInfo({ drivers }), vars({
    2: { lap: 5, pct: 0.60, pos: 1, cpos: 1 },
    1: { lap: 5, pct: 0.40, pos: 2, cpos: 2 },
    5: { lap: 5, pct: 0.45, pos: 3, cpos: 3, surf: -1 },
    3: { lap: 5, pct: 0.39, pos: 4, cpos: 4 },
    4: { lap: 5, pct: 0.41, pos: 5, cpos: 5 },
    6: { lap: 5, pct: 0.395, pos: 6, cpos: 1 },
  })), G());
  const me = byIdx(st, 1);
  assert.equal(me.classPosition, 2, 'official position untouched');
  assert.equal(me.liveAhead, 4);
  assert.equal(byIdx(st, 4).liveAhead, 2);
  assert.equal(byIdx(st, 3).liveAhead, 1, 'the car right behind me on track');
  assert.equal(byIdx(st, 2).liveAhead, null);
  assert.equal(byIdx(st, 5).liveAhead, null, 'cars out of the world are skipped');
  assert.equal(byIdx(st, 6).liveAhead, null, 'other classes are not neighbours');
  assert.ok(me.liveInterval > 0 && me.liveInterval < 3, String(me.liveInterval));
  assert.ok(byIdx(st, 3).liveInterval > 0 && byIdx(st, 3).liveInterval < 2);
});

// ---------- relative ----------
test('relative: sorted ahead -> behind, excludes player and cars not in world, lap differences', () => {
  const drivers = [driver(1, GT3), driver(2, GT3), driver(3, GT3), driver(4, GT3), driver(5, GT3)];
  const st = new RaceModel().update(frame(sessionInfo({ drivers }), vars({
    1: { pct: 0.5, lap: 3, est: 50 },
    2: { pct: 0.52, lap: 3, est: 52 }, // 2 s ahead
    3: { pct: 0.45, lap: 3, est: 45 }, // 5 s behind
    4: { pct: 0.49, lap: 4, est: 49 }, // 1 s behind on track, a lap up
    5: { pct: -1, lap: -1 },
  })), G());
  assert.deepEqual(st.relative.map((r) => r.idx), [2, 4, 3]);
  const r = Object.fromEntries(st.relative.map((x) => [x.idx, x]));
  assert.ok(Math.abs(r[2].gap - 2) < 1e-9);
  assert.ok(Math.abs(r[3].gap + 5) < 1e-9);
  assert.equal(r[4].lapDiff, 1);
  assert.equal(r[2].lapDiff, 0);
  assert.ok(Math.abs(r[2].meters - 0.02 * 4000) < 1e-9);
});

test('relative: wraps across the start/finish line', () => {
  const drivers = [driver(1, GT3), driver(2, GT3)];
  const st = new RaceModel().update(frame(sessionInfo({ drivers }), vars({ 1: { pct: 0.99, est: 99 }, 2: { pct: 0.01, lap: 1, est: 1 } })), G());
  assert.ok(Math.abs(st.relative[0].gap - 2) < 1e-9, `gap ${st.relative[0].gap}`);
  assert.ok(st.relative[0].dPct > 0);
});

test('relative: falls back to track position when est times are missing or disagree', () => {
  const drivers = [driver(1, GT3), driver(2, GT3), driver(3, GT3)];
  const st = new RaceModel().update(frame(sessionInfo({ drivers }), vars({
    1: { pct: 0.5, est: 50 }, 2: { pct: 0.6, est: 0 }, 3: { pct: 0.4, est: 70 }, // est says ahead, track says 10% behind
  })), G());
  const r = Object.fromEntries(st.relative.map((x) => [x.idx, x]));
  assert.ok(Math.abs(r[2].gap - 10) < 1e-9);
  assert.ok(Math.abs(r[3].gap + 10) < 1e-9);
});

test('relative: a faster-class car just ahead reads as ahead (est times scaled to my class)', () => {
  const drivers = [driver(1, GT3), driver(2, LMP2)];
  // LMP2 est lap 90 s, GT3 100 s; the LMP2 is 0.5% of a lap ahead of me
  const st = new RaceModel().update(frame(sessionInfo({ drivers }), vars({ 1: { pct: 0.5, est: 50 }, 2: { pct: 0.505, est: 0.505 * 90 } })), G());
  const r = st.relative[0];
  assert.ok(r.gap > 0, `gap ${r.gap}`);
  assert.ok(Math.abs(r.gap - 0.5) < 1e-6);
});

test('relative, multiclass: gaps are measured from our own timing, not iRacing class estimates', () => {
  // iRacing's class estimates are way off (and EstTime missing); the LMP2 is really closing from behind
  const drivers = [driver(1, { ...GT3, est: 60 }), driver(2, { ...LMP2, est: 200 })];
  const info = sessionInfo({ drivers });
  const m = new RaceModel();
  const me = { start: 0.30, speed: 1 / 100 }, p2 = { start: 0.25, speed: 1 / 90 };
  let st, T = 0;
  for (let t = 0; t <= 20 + 1e-9; t += 0.05) {
    T = t;
    const a = me.start + me.speed * t, b = p2.start + p2.speed * t;
    st = m.update(frame(info, vars({ 1: { pct: a % 1, lap: Math.floor(a) }, 2: { pct: b % 1, lap: Math.floor(b) } }, { SessionTime: t })), G());
  }
  const pb = p2.start + p2.speed * T;
  const expected = -(T - (pb - me.start) / me.speed); // behind: how long ago I was where it is now
  const r = st.relative.find((x) => x.idx === 2);
  assert.ok(Math.abs(r.gap - expected) < 0.05, `gap ${r.gap} vs ${expected}`);
});

test("lap timing 'Best' uses iRacing's own session best lap when it has one", () => {
  const info = sessionInfo({ drivers: [driver(1, GT3)], type: 'Practice' });
  const m = new RaceModel();
  let st = m.update(frame(info, vars({ 1: { pct: 0.2 } }, { LapBestLapTime: 98.765 })), G());
  assert.equal(st.timing.bestLap, 98.765);
  st = m.update(frame(info, vars({ 1: { pct: 0.21 } }, { SessionTime: 101, LapBestLapTime: -1 })), G());
  assert.equal(st.timing.bestLap, null, 'no official best yet: our own (none timed)');
});

test('relative / radar are empty when the player is not in the world', () => {
  const drivers = [driver(1, GT3), driver(2, GT3)];
  const st = new RaceModel().update(frame(sessionInfo({ drivers }), vars({ 1: { pct: -1, lap: -1 }, 2: { pct: 0.3 } })), G());
  assert.deepEqual(st.relative, []);
  assert.deepEqual(st.radar.cars, []);
});

test('radar: cars within 100 m that are not on pit road', () => {
  const drivers = [driver(1, GT3), driver(2, GT3), driver(3, GT3), driver(4, GT3)];
  const st = new RaceModel().update(frame(sessionInfo({ drivers }), vars({
    1: { pct: 0.5, est: 50 }, 2: { pct: 0.51, est: 51 }, 3: { pct: 0.49, est: 49, pit: true }, 4: { pct: 0.6, est: 60 },
  }, { CarLeftRight: 2 })), G());
  assert.equal(st.radar.state, 2);
  assert.deepEqual(st.radar.cars.map((c) => c.idx), [2]);
  assert.ok(Math.abs(st.radar.cars[0].meters - 40) < 1e-6);
});

test('focus follows the camera car in replays when enabled', () => {
  const drivers = [driver(1, GT3), driver(2, GT3)];
  const f = frame(sessionInfo({ drivers }), vars({ 1: { pct: 0.5 }, 2: { pct: 0.6 } }, { IsReplayPlaying: true, CamCarIdx: 2 }));
  assert.equal(byIdx(new RaceModel().update(f, G()), 2).isPlayer, true);
  assert.equal(byIdx(new RaceModel().update(f, G({ focusCamCar: false })), 1).isPlayer, true);
});

// ---------- pit stops / session change ----------
test('pit stops are counted in races and reset on a new session', () => {
  const drivers = [driver(1, GT3), driver(2, GT3)];
  const info = sessionInfo({ drivers });
  const m = new RaceModel();
  const at = (pit, sessionNum = 0) => m.update(frame(info, vars({ 1: { pct: 0.5, lap: 2 }, 2: { pct: 0.1, lap: 3, pit } }, { SessionNum: sessionNum })), G());
  at(false); at(true); at(true); at(false); at(true);
  assert.equal(byIdx(at(true), 2).pitStops, 2);
  assert.equal(byIdx(at(false, 1), 2).pitStops, 0);
});

// ---------- class splits ----------
test('class splits: sub-classes renumber positions 1..n, get their own SOF, colors and order', () => {
  const drivers = [1, 2, 3, 4, 5, 6].map((i) => driver(i, GT3, { CarNumber: String(i * 10), IRating: 1000 * i })).concat([driver(7, LMP2)]);
  const splits = [
    { name: 'GT3 Pro', color: '#f97316', from: 'GT3', match: 'numbers', numbers: '1-35' },
    { name: 'GT3 Am', color: '#a855f7', from: 'GT3', match: 'rest' },
  ];
  // overall order: 7 (LMP2), then GT3 1..6
  const cars = { 7: { pos: 1, cpos: 1, pct: 0.9 } };
  [1, 2, 3, 4, 5, 6].forEach((i) => { cars[i] = { pos: i + 1, cpos: i, pct: 0.8 - i * 0.01 }; });
  const m = new RaceModel();
  const st = m.update(frame(sessionInfo({ drivers, player: 5 }), vars(cars, { PlayerCarIdx: 5 })), G({ classSplits: splits }));
  assert.deepEqual(st.classes.map((k) => k.name), ['LMP2', 'GT3 Pro', 'GT3 Am']);
  const pro = st.cars.filter((c) => c.className === 'GT3 Pro').sort((a, b) => a.idx - b.idx);
  const am = st.cars.filter((c) => c.className === 'GT3 Am').sort((a, b) => a.idx - b.idx);
  assert.deepEqual(pro.map((c) => [c.idx, c.classPosition]), [[1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(am.map((c) => [c.idx, c.classPosition]), [[4, 1], [5, 2], [6, 3]]);
  assert.equal(am[0].classColor, '#a855f7');
  assert.equal(am[0].baseClass, 'GT3');
  assert.equal(am[0].gap, 0, 'sub-class leader');
  assert.equal(st.player.classPosition, 2);
  assert.equal(st.player.classCount, 3);
  const amK = st.classes.find((k) => k.name === 'GT3 Am');
  assert.equal(amK.sof, st.session.sof);
  assert.ok(amK.sof > 4000 && amK.sof < 6000);
  assert.equal(amK.renumber, undefined, 'internal flags are not sent');
  // LMP2 untouched
  assert.equal(byIdx(st, 7).classPosition, 1);
  assert.equal(byIdx(st, 7).className, 'LMP2');
});

test('class splits: positions gained are counted within the sub-class from the grid order', () => {
  const drivers = [1, 2, 3, 4].map((i) => driver(i, GT3));
  const splits = [{ name: 'Am', from: 'GT3', match: 'numbers', numbers: '3-4' }];
  const info = sessionInfo({ drivers, player: 3 });
  const m = new RaceModel();
  const grid = { 1: { pos: 1, cpos: 1 }, 2: { pos: 2, cpos: 2 }, 3: { pos: 3, cpos: 3 }, 4: { pos: 4, cpos: 4 } };
  m.update(frame(info, vars(grid, { PlayerCarIdx: 3 })), G({ classSplits: splits }));
  // car 4 passes car 3
  const st = m.update(frame(info, vars({ 1: { pos: 1, cpos: 1 }, 2: { pos: 2, cpos: 2 }, 3: { pos: 4, cpos: 4 }, 4: { pos: 3, cpos: 3 } }, { PlayerCarIdx: 3 })), G({ classSplits: splits }));
  assert.equal(byIdx(st, 4).classPosition, 1);
  assert.equal(byIdx(st, 4).startPos, 2);
  assert.equal(byIdx(st, 4).posGain, 1);
  assert.equal(byIdx(st, 3).posGain, -1);
  assert.equal(byIdx(st, 1).posGain, 0, 'non-split class keeps iRacing class positions');
});

test('class splits: rules re-apply when changed and removing them restores iRacing classes', () => {
  const drivers = [driver(1, GT3), driver(2, GT3)];
  const info = sessionInfo({ drivers });
  const m = new RaceModel();
  const v = vars({ 1: { pos: 1, cpos: 1 }, 2: { pos: 2, cpos: 2 } });
  let st = m.update(frame(info, v), G({ classSplits: [{ name: 'Am', match: 'numbers', numbers: '2' }] }));
  assert.equal(byIdx(st, 2).className, 'Am');
  assert.equal(st.classes.length, 2);
  st = m.update(frame(info, v), G({ classSplits: [] }));
  assert.equal(byIdx(st, 2).className, 'GT3');
  assert.equal(byIdx(st, 2).classPosition, 2);
  assert.equal(st.classes.length, 1);
});

test('class splits: league-limited rules only apply in that league', () => {
  const drivers = [driver(1, GT3), driver(2, GT3)];
  const splits = [{ name: 'Am', match: 'rest', league: '555' }];
  const st1 = new RaceModel().update(frame(sessionInfo({ drivers, league: 555 }), vars({ 1: {}, 2: {} })), G({ classSplits: splits }));
  assert.ok(st1.cars.every((c) => c.className === 'Am'));
  const st2 = new RaceModel().update(frame(sessionInfo({ drivers, league: 1 }), vars({ 1: {}, 2: {} })), G({ classSplits: splits }));
  assert.ok(st2.cars.every((c) => c.className === 'GT3'));
});

test('classPreview lists everyone with their iRacing class and sub-class', () => {
  const drivers = [driver(0, GT3, { CarIsPaceCar: 1 }), driver(1, GT3, { UserName: 'Ann' }), driver(2, LMP2)];
  const m = new RaceModel();
  m.update(frame(sessionInfo({ drivers, league: 42 }), vars({ 1: {}, 2: {} })), G());
  const p = m.classPreview([{ name: 'Am', color: '#00f', from: 'GT3', match: 'drivers', drivers: 'ann' }]);
  assert.equal(p.leagueId, 42);
  assert.equal(p.drivers.length, 2);
  const ann = p.drivers.find((d) => d.name === 'Ann');
  assert.deepEqual([ann.baseClass, ann.split, ann.splitColor], ['GT3', 'Am', '#00f']);
  assert.equal(p.drivers.find((d) => d.baseClass === 'LMP2').split, '');
});

// ---------- fuel / laps to go ----------
test('fuel: per-lap usage from clean green-flag laps only', () => {
  const drivers = [driver(1, GT3)];
  const info = sessionInfo({ drivers });
  const m = new RaceModel();
  const at = (lap, fuel, extra = {}) => m.update(frame(info, vars({ 1: { lap, pct: 0.5 } }, { LapCompleted: lap, FuelLevel: fuel, ...extra })), G());
  at(0, 50); // partial first lap
  at(1, 47); // not valid (partial)
  at(2, 44); // valid: 3 L
  at(3, 41.5); // valid: 2.5 L
  at(3, 41, { OnPitRoad: true });
  at(4, 38); // lap 3 had a pit visit: not counted
  at(5, 35); // lap 4: valid, 3 L
  let st = at(6, 32, { SessionFlags: 0x4000 }); // caution out as lap 5 ends -> not counted
  assert.deepEqual(st.fuel.laps, [3, 2.5, 3]);
  // refuelling raises the lap's starting fuel
  at(6, 80);
  st = at(7, 77);
  assert.deepEqual(st.fuel.laps, [3, 2.5, 3, 3]);
  assert.equal(st.fuel.max, 100);
});

test('laps to go: from laps remaining, or from time remaining and the reference lap', () => {
  const drivers = [driver(1, GT3)];
  const lapsBased = new RaceModel().update(frame(sessionInfo({ drivers }), vars({ 1: { pct: 0.25, last: 100 } }, { SessionLapsRemainEx: 10 })), G());
  assert.equal(lapsBased.fuel.lapsToGo, 9.75);
  assert.equal(lapsBased.session.lapsRemain, 10);
  const timed = new RaceModel().update(frame(sessionInfo({ drivers }), vars({ 1: { pct: 0.25, last: 100 } }, { SessionLapsRemainEx: 32767, SessionTimeRemain: 500 })), G());
  assert.equal(timed.session.lapsRemain, null);
  assert.equal(timed.session.timeRemain, 500);
  // ceil(500 / 100 + 0.75) = 6, minus the 0.25 already done
  assert.equal(timed.fuel.lapsToGo, 5.75);
});

// ---------- own-trace delta fallback ----------
test('without iRacing deltas, "vs last" comes from our own lap traces and last lap from our log', () => {
  const drivers = [driver(1, GT3)];
  const info = sessionInfo({ drivers });
  const m = new RaceModel();
  let st;
  for (let t = 0; t <= 1.5 + 30 * 2; t += 0.05) {
    const d = 0.95 + t / 30;
    st = m.update(frame(info, vars({ 1: { pct: d % 1, lap: Math.floor(d) } }, { SessionTime: t, LapCompleted: Math.floor(d), LapDistPct: d % 1, LapLastLapTime: -1 })), G());
  }
  assert.equal(st.player.deltas.sessionLast[2], true);
  assert.ok(Math.abs(st.player.deltas.sessionLast[0]) < 0.1);
  assert.ok(Math.abs(st.player.lastLap - 30) < 1e-6);
  assert.ok(st.timing.log.length >= 1);
});

test('iRacing deltas are used as-is when valid', () => {
  const drivers = [driver(1, GT3)];
  const st = new RaceModel().update(frame(sessionInfo({ drivers }), vars({ 1: {} }, { LapDeltaToBestLap: -0.3, LapDeltaToBestLap_DD: 0.01, LapDeltaToBestLap_OK: true })), G());
  assert.deepEqual(st.player.deltas.best, [-0.3, 0.01, true]);
});

// ---------- track map learning ----------
test('learns a track map from one clean lap of dead reckoning', () => {
  const drivers = [driver(1, GT3)];
  const info = sessionInfo({ drivers });
  const learned = [];
  const m = new RaceModel({ onTrackLearned: (id, pts) => learned.push([id, pts]) });
  const lap = 60, R = 500, v = (2 * Math.PI * R) / lap;
  let st;
  for (let t = 0; t <= lap * 1.1; t += 0.05) {
    const p = (t / lap) % 1;
    st = m.update(frame(info, vars({ 1: { pct: p, lap: Math.floor(t / lap) } }, { SessionTime: t, VelocityX: v, VelocityY: 0, Yaw: 2 * Math.PI * p + Math.PI / 2 })), G());
    if (t > 1 && t < 2) assert.ok(st.trackMap.learning > 0 && st.trackMap.learning < 1);
  }
  assert.equal(learned.length, 1);
  const [id, pts] = learned[0];
  assert.equal(id, m.track.id);
  assert.equal(pts.length, 500);
  // a circle of radius R: every point ~R from the centre (start at (0,0) on the circle's edge)
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  for (const p of pts.filter((_, i) => i % 50 === 0)) assert.ok(Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - R) < R * 0.05);
  assert.equal(st.trackMap.learning, 1);
  assert.equal(st.trackMap.points, pts);
});

test('known track maps are used directly (demo track)', () => {
  const { state } = demoRace({ seconds: 5 });
  assert.equal(state.trackMap.learning, 1);
  assert.ok(state.trackMap.points.length > 100);
});

// ---------- demo integration ----------
test('demo race: full state shape', () => {
  const { state } = demoRace();
  for (const k of ['connected', 'session', 'player', 'cars', 'classes', 'relative', 'radar', 'fuel', 'trackMap', 'timing']) assert.ok(k in state, k);
  assert.equal(state.cars.length, 22);
  assert.equal(state.cars.filter((c) => c.isPlayer).length, 1);
  assert.equal(state.player.classCount, 14);
  assert.ok(state.player.speed > 0);
  assert.ok(state.relative.length > 0);
});

// BUG: the own-trace "vs best" fallback never becomes valid without iRacing's lap times, because
// TimingTracker never records a best lap while bestLap is null (src/main/timing.js:134,136).
test('without iRacing deltas, "vs best" comes from our own best lap trace', () => {
  const info = sessionInfo({ drivers: [driver(1, GT3)] });
  const m = new RaceModel();
  let st;
  for (let t = 0; t <= 1.5 + 30 * 2; t += 0.05) {
    const d = 0.95 + t / 30;
    st = m.update(frame(info, vars({ 1: { pct: d % 1, lap: Math.floor(d) } }, { SessionTime: t, LapCompleted: Math.floor(d), LapLastLapTime: -1, LapBestLapTime: -1 })), G());
  }
  assert.equal(st.player.deltas.best[2], true);
  assert.ok(st.player.bestLap > 0);
});
