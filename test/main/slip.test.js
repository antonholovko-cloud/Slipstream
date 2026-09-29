const test = require('node:test');
const assert = require('node:assert/strict');
const { SlipEstimator } = require('../../src/main/slip');

const RATIO = 100; // rpm per m/s in gear 3
// Feed `n` calm frames (throttle on, brake off) at a steady ratio, 60 Hz from time t0.
function learn(s, { gear = 3, n = 60, t0 = 0, ratio = RATIO, speed = 40 } = {}) {
  let out;
  for (let i = 0; i < n; i++) out = s.update({ SessionTime: t0 + 1 + i / 60, Gear: gear, Speed: speed, RPM: speed * ratio, Throttle: 0.8, Brake: 0, Clutch: 1 });
  return out;
}

test('nothing learned yet: dev 0, learned false', () => {
  const s = new SlipEstimator();
  const out = s.update({ SessionTime: 1, Gear: 3, Speed: 40, RPM: 4000, Throttle: 1, Brake: 0, Clutch: 1 });
  assert.deepEqual(out, { dev: 0, learned: false, abs: false });
});

test('learns the gear ratio after 30 calm samples, then dev ~ 0 at that ratio', () => {
  const s = new SlipEstimator();
  s.update({ SessionTime: 0, Gear: 3, Speed: 40, RPM: 4000, Throttle: 0.8, Brake: 0, Clutch: 1 }); // gear change at t=0
  const out = learn(s);
  assert.equal(out.learned, true);
  assert.ok(Math.abs(out.dev) < 1e-9);
  assert.equal(s.gears.get(3).ratio, RATIO);
});

test('wheelspin reads as positive deviation, lock-up as negative', () => {
  const s = new SlipEstimator();
  s.update({ SessionTime: 0, Gear: 3, Speed: 40, RPM: 4000, Throttle: 0.8, Brake: 0, Clutch: 1 });
  learn(s);
  const spin = s.update({ SessionTime: 3, Gear: 3, Speed: 40, RPM: 4000 * 1.12, Throttle: 1, Brake: 0, Clutch: 1 });
  assert.ok(Math.abs(spin.dev - 0.12) < 1e-9);
  const lock = s.update({ SessionTime: 3.1, Gear: 3, Speed: 40, RPM: 4000 * 0.8, Throttle: 0, Brake: 0.9, Clutch: 1, BrakeABSactive: true });
  assert.ok(Math.abs(lock.dev + 0.2) < 1e-9);
  assert.equal(lock.abs, true);
});

test('the median ignores short spin bursts while learning', () => {
  const s = new SlipEstimator();
  s.update({ SessionTime: 0, Gear: 2, Speed: 20, RPM: 2000, Throttle: 0.8, Brake: 0, Clutch: 1 });
  for (let i = 0; i < 40; i++) {
    const r = i % 5 === 0 ? RATIO * 1.3 : RATIO; // 20% of samples spinning
    s.update({ SessionTime: 1 + i / 60, Gear: 2, Speed: 20, RPM: 20 * r, Throttle: 1, Brake: 0, Clutch: 1 });
  }
  assert.equal(s.gears.get(2).ratio, RATIO);
});

test('braking frames are not learned from', () => {
  const s = new SlipEstimator();
  s.update({ SessionTime: 0, Gear: 3, Speed: 40, RPM: 4000, Throttle: 0, Brake: 0.5, Clutch: 1 });
  for (let i = 0; i < 60; i++) s.update({ SessionTime: 1 + i / 60, Gear: 3, Speed: 40, RPM: 3000, Throttle: 0, Brake: 0.5, Clutch: 1 });
  assert.equal(s.gears.get(3).samples.length, 0);
});

test('ignored: neutral/reverse, slow, clutch in, just after a shift, very low rpm', () => {
  const s = new SlipEstimator();
  s.update({ SessionTime: 0, Gear: 3, Speed: 40, RPM: 4000, Throttle: 0.8, Brake: 0, Clutch: 1 });
  learn(s);
  const base = { SessionTime: 5, Gear: 3, Speed: 40, RPM: 8000, Throttle: 1, Brake: 0, Clutch: 1 };
  for (const patch of [{ Gear: 0 }, { Gear: -1 }, { Speed: 5 }, { Clutch: 0.5 }, { RPM: 400 }]) {
    assert.equal(s.update({ ...base, ...patch }).dev, 0, JSON.stringify(patch));
  }
  // shift to 4th then straight back: settled only 0.4 s after the change
  s.update({ ...base, SessionTime: 6, Gear: 4 });
  assert.equal(s.update({ ...base, SessionTime: 6.2 }).dev, 0);
});

test('each gear keeps its own ratio; reset clears everything', () => {
  const s = new SlipEstimator();
  s.update({ SessionTime: 0, Gear: 2, Speed: 30, RPM: 3000, Throttle: 0.8, Brake: 0, Clutch: 1 });
  learn(s, { gear: 2, ratio: 150, t0: 0 });
  s.update({ SessionTime: 10, Gear: 4, Speed: 30, RPM: 3000, Throttle: 0.8, Brake: 0, Clutch: 1 });
  learn(s, { gear: 4, ratio: 70, t0: 10 });
  assert.equal(s.gears.get(2).ratio, 150);
  assert.equal(s.gears.get(4).ratio, 70);
  s.reset();
  assert.equal(s.gears.size, 0);
});

test('missing fields default safely', () => {
  const s = new SlipEstimator();
  assert.deepEqual(s.update({}), { dev: 0, learned: false, abs: false });
});
