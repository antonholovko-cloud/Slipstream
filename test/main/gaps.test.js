const test = require('node:test');
const assert = require('node:assert/strict');
const { GapTracker, BINS } = require('../../src/main/gaps');

// Drive two cars at constant speed (laps per second) and feed the tracker every dt.
function run(g, cars, { from = 0, to = 60, dt = 0.05 } = {}) {
  for (let t = from; t <= to + 1e-9; t += dt) {
    g.update(t, cars.map((c) => ({ idx: c.idx, p: c.start + c.speed * t })));
  }
}

test('progress: null when not in world', () => {
  const g = new GapTracker();
  assert.equal(g.progress(1, -1, 0.5), null);
  assert.equal(g.progress(1, 2, -1), null);
  assert.equal(g.progress(1, 2, NaN), null);
});

test('progress: laps + fraction, fixes S/F line disagreements', () => {
  const g = new GapTracker();
  assert.equal(g.progress(1, 3, 0.25), 3.25);
  g.update(0, [{ idx: 1, p: 3.98 }]);
  // pct wrapped to 0.01 but lap count still 3 -> 4.01
  assert.ok(Math.abs(g.progress(1, 3, 0.01) - 4.01) < 1e-9);
  // lap count already 4 but pct still 0.99 -> 3.99
  g.update(1, [{ idx: 1, p: 3.98 }]);
  assert.ok(Math.abs(g.progress(1, 4, 0.99) - 3.99) < 1e-9);
});

test('gap between two cars at the same speed equals the time offset', () => {
  const g = new GapTracker();
  const speed = 1 / 90; // 90 s laps
  run(g, [{ idx: 1, start: 0.1, speed }, { idx: 2, start: 0.1 - 2 * speed, speed }]);
  const gap = g.gap(1, 2);
  assert.ok(Math.abs(gap - 2) < 0.05, `gap ${gap}`);
});

test('gap counts whole laps for lapped cars', () => {
  const g = new GapTracker();
  const speed = 1 / 60;
  // car 2 is 1 lap + 5 s behind; history must cover the full lap
  run(g, [{ idx: 1, start: 1.5, speed }, { idx: 2, start: 1.5 - 1 - 5 * speed, speed }], { to: 200 });
  const gap = g.gap(1, 2);
  assert.ok(Math.abs(gap - 65) < 0.1, `gap ${gap}`);
});

test('gap is null when the car "ahead" is actually behind, or unknown', () => {
  const g = new GapTracker();
  run(g, [{ idx: 1, start: 0.5, speed: 0.01 }, { idx: 2, start: 0.4, speed: 0.01 }], { to: 5 });
  assert.equal(g.gap(2, 1), null);
  assert.equal(g.gap(1, 99), null);
});

test('gap is null before the car ahead has passed the other car\'s position', () => {
  const g = new GapTracker();
  // front car starts far ahead: it never crossed the bins where the back car is now
  g.update(0, [{ idx: 1, p: 0.8 }, { idx: 2, p: 0.1 }]);
  g.update(0.1, [{ idx: 1, p: 0.801 }, { idx: 2, p: 0.101 }]);
  assert.equal(g.gap(1, 2), null);
});

test('sub-bin gap (side by side) uses the lap time', () => {
  const g = new GapTracker();
  const speed = 1 / 100;
  run(g, [{ idx: 1, start: 0, speed }, { idx: 2, start: -0.001, speed }], { to: 130 });
  const gap = g.gap(1, 2);
  assert.ok(gap >= 0 && gap < 0.5, `gap ${gap}`);
});

test('teleport clears history, rewind resets, and missing cars are dropped', () => {
  const g = new GapTracker();
  run(g, [{ idx: 1, start: 0, speed: 0.01 }], { to: 10 });
  assert.ok(g.cars.get(1).cross.size > 0);
  g.update(10.1, [{ idx: 1, p: 0.1 + 0.5 }]); // jump of half a lap
  assert.equal(g.cars.get(1).cross.size, 0);
  g.update(11, []); // car left the world
  assert.equal(g.cars.has(1), false);
  g.update(12, [{ idx: 3, p: 0.2 }]);
  g.update(5, [{ idx: 3, p: 0.2 }]); // time went backwards
  assert.equal(g.lastTime, 5);
  assert.equal(g.cars.get(3).cross.size, 0);
});

test('history is limited to a few laps', () => {
  const g = new GapTracker();
  run(g, [{ idx: 1, start: 0, speed: 1 / 10 }], { to: 100 }); // 10 laps
  assert.ok(g.cars.get(1).cross.size <= 3 * BINS + 1);
});

test('null progress entries are skipped', () => {
  const g = new GapTracker();
  g.update(0, [{ idx: 1, p: null }]);
  assert.equal(g.cars.size, 0);
});

test('trackGap: time on track between two cars, ignoring laps (a lapped car just ahead)', () => {
  const g = new GapTracker();
  const speed = 1 / 90;
  // #1 is a lap and 2 s up the road in the race, but on track it's 2 s ahead of #2
  run(g, [{ idx: 1, start: 1.1, speed }, { idx: 2, start: 0.1 - 2 * speed, speed }], { to: 120 });
  assert.ok(Math.abs(g.gap(1, 2) - 92) < 0.1, 'race gap counts the lap');
  assert.ok(Math.abs(g.trackGap(1, 2) - 2) < 0.05, `track gap ${g.trackGap(1, 2)}`);
  // and the other way round: #2 is ~88 s "ahead" of #1 on track
  assert.ok(Math.abs(g.trackGap(2, 1) - 88) < 0.1);
});

test('trackGap: cars at different pace (multiclass): measured from the car in front', () => {
  const g = new GapTracker();
  const front = { idx: 1, start: 0.2, speed: 1 / 100 }; // slower class, ahead
  const back = { idx: 2, start: 0.17, speed: 1 / 90 }; // faster class, closing
  run(g, [front, back], { to: 20 });
  const T = 20, pb = back.start + back.speed * T;
  const expected = T - (pb - front.start) / front.speed; // since front was where back is now
  assert.ok(Math.abs(g.trackGap(1, 2) - expected) < 0.05, `${g.trackGap(1, 2)} vs ${expected}`);
});

test('trackGap: unknown without history, side by side uses the lap time once known', () => {
  const g = new GapTracker();
  g.update(0, [{ idx: 1, p: 0.505 }, { idx: 2, p: 0.5 }]);
  assert.equal(g.trackGap(1, 2), null);
  assert.equal(g.trackGap(1, 9), null);
  const speed = 1 / 60;
  const h = new GapTracker();
  run(h, [{ idx: 1, start: 0.5 + 0.2 * speed, speed }, { idx: 2, start: 0.5, speed }], { to: 70 });
  assert.ok(Math.abs(h.trackGap(1, 2) - 0.2) < 0.02);
});
