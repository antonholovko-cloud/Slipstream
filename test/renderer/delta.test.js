const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');
const { THEMES } = require('../../src/shared/registry');

const T = THEMES.carbon;
const race = demoRace();
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

// Put the player 2nd in class: ahead = P1, behind = P3, everyone else further back.
function placeP2(st) {
  const me = st.cars.find((c) => c.isPlayer);
  const others = st.cars.filter((c) => c.classId === me.classId && !c.isPlayer);
  others.forEach((c, i) => { c.classPosition = i === 0 ? 1 : i + 2; });
  me.classPosition = 2;
  return { me, ahead: others[0], behind: others[1] };
}
function withDelta(best, p = {}) {
  const st = structuredClone(race.state);
  st.player.deltas.best = best;
  Object.assign(st.player, { lapTime: 30.21, bestLap: 70.9, lastLap: 71.5 }, p);
  return st;
}
const fill = (ov) => ov.$('.bar i').style;
const gap = (ov, side) => {
  const el = ov.$('.gap.' + side);
  return { who: el.querySelector('.who').textContent, sec: el.querySelector('.sec').textContent, width: parseFloat(el.querySelector('.gbar i').style.width), color: el.querySelector('.gbar i').style.background };
};

test('gaining: green bar to the left of centre, signed value, lap times', async () => {
  const ov = await loadOverlay('delta', { settings: { range: 1, decimals: 2 } });
  ov.render(withDelta([-0.25, -0.1, true]));
  assert.equal(ov.$('.val').textContent, '-0.25');
  assert.equal(ov.$('.val').style.color, rgb(T.green));
  assert.equal(parseFloat(fill(ov).left), 37.5);
  assert.equal(parseFloat(fill(ov).width), 12.5);
  assert.equal(fill(ov).background, rgb(T.green));
  assert.equal(ov.$('.l').textContent, '30.2'); // current lap
  assert.equal(ov.$('.r').textContent, '≈ 1:10.65'); // predicted: best + delta
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('losing: red bar to the right, clamped at the range', async () => {
  const ov = await loadOverlay('delta', { settings: { range: 1 } });
  ov.render(withDelta([2.5, 0.1, true]));
  assert.equal(ov.$('.val').textContent, '+2.50');
  assert.equal(parseFloat(fill(ov).left), 50);
  assert.equal(parseFloat(fill(ov).width), 50);
  assert.equal(fill(ov).background, rgb(T.red));
  ov.close();
});

test('trend coloring: bar follows the rate of change when showTrend is on', async () => {
  const ov = await loadOverlay('delta');
  ov.render(withDelta([0.3, -0.1, true])); // behind but gaining
  assert.equal(fill(ov).background, rgb(T.green));
  assert.equal(ov.$('.val').style.color, rgb(T.red), 'the number stays red while behind');
  ov.configure({ showTrend: false });
  ov.render(withDelta([0.3, -0.1, true]));
  assert.equal(fill(ov).background, rgb(T.red));
  ov.close();
});

test('no valid delta: dash, reference label, empty bar', async () => {
  const ov = await loadOverlay('delta');
  ov.render(withDelta([0, 0, false]));
  assert.equal(ov.$('.val').textContent, '–');
  assert.equal(ov.$('.val').style.color, rgb(T.dim));
  assert.equal(parseFloat(fill(ov).width), 0);
  assert.equal(ov.$('.r').textContent, 'vs best');
  ov.close();
});

test('reference: each choice reads its own delta; predicted lap only for best / last', async () => {
  const ov = await loadOverlay('delta', { settings: { reference: 'optimal' } });
  const st = withDelta([0, 0, false]);
  st.player.deltas.optimal = [0.5, 0, true];
  ov.render(st);
  assert.equal(ov.$('.val').textContent, '+0.50');
  assert.equal(ov.$('.r').textContent, 'vs optimal');
  ov.configure({ reference: 'sessionLast' });
  st.player.deltas.sessionLast = [-1, 0, true];
  ov.render(st);
  assert.equal(ov.$('.r').textContent, '≈ 1:10.50');
  ov.configure({ reference: 'sessionBest' });
  st.player.deltas.sessionBest = [0, 0, false];
  ov.render(st);
  assert.equal(ov.$('.val').textContent, '–', 'sessionBest has no valid delta in this state');
  assert.equal(ov.$('.r').textContent, 'vs session best');
  ov.close();
});

test('lap times can be hidden', async () => {
  const ov = await loadOverlay('delta', { settings: { showLapTimes: false } });
  assert.equal(ov.$('.l').style.visibility, 'hidden');
  assert.equal(ov.$('.r').style.visibility, 'hidden');
  ov.close();
});

test('gap bars by class position in a race: interval ahead, behind car interval, names', async () => {
  const st = withDelta([0, 0, true]);
  const { me, ahead, behind } = placeP2(st);
  me.interval = 1.234; behind.interval = 0.5;
  ahead.dist = me.dist + 0.1; behind.dist = me.dist - 0.1;
  const ov = await loadOverlay('delta', { settings: { gapScale: 2 } });
  ov.render(st);
  const a = gap(ov, 'ahead'), b = gap(ov, 'behind');
  assert.equal(a.sec, '1.23s');
  assert.match(a.who, new RegExp(`^#${ahead.number} `));
  assert.equal(a.width, 38.3); // 1 - 1.234 / 2
  assert.equal(a.color, rgb(T.accent), 'no trend yet: neutral');
  assert.equal(b.sec, '0.50s');
  assert.equal(b.width, 75);
  assert.equal(b.color, rgb(T.yellow));
  ov.close();
});

test('gap bars show laps when a lap or more apart', async () => {
  const st = withDelta([0, 0, true]);
  const { me, ahead } = placeP2(st);
  ahead.dist = me.dist + 1.5;
  const ov = await loadOverlay('delta');
  ov.render(st);
  assert.equal(gap(ov, 'ahead').sec, '1L');
  assert.equal(gap(ov, 'ahead').width, 0);
  ov.close();
});

test('class leader has no car ahead', async () => {
  const st = withDelta([0, 0, true]);
  const me = st.cars.find((c) => c.isPlayer);
  for (const c of st.cars) if (c.classId === me.classId && c !== me && c.classPosition <= me.classPosition) c.classPosition = me.classPosition + 20;
  me.classPosition = 1;
  const ov = await loadOverlay('delta');
  ov.render(st);
  assert.deepEqual(gap(ov, 'ahead'), { who: '', sec: '–', width: 0, color: '' });
  ov.close();
});

test('gapMode "track": nearest cars on track from the relative', async () => {
  const st = withDelta([0, 0, true]);
  const others = st.cars.filter((c) => !c.isPlayer);
  st.relative = [{ idx: others[0].idx, gap: 3.2 }, { idx: others[1].idx, gap: 0.8 }, { idx: others[2].idx, gap: -0.4 }, { idx: others[3].idx, gap: -2 }];
  const ov = await loadOverlay('delta', { settings: { gapMode: 'track', gapNames: false } });
  ov.render(st);
  assert.deepEqual([gap(ov, 'ahead').sec, gap(ov, 'behind').sec], ['0.80s', '0.40s']);
  assert.equal(gap(ov, 'ahead').who, '');
  ov.close();
});

test('trend: closing on the car ahead turns its bar green, losing turns it red', async () => {
  const st = withDelta([0, 0, true]);
  const others = st.cars.filter((c) => !c.isPlayer);
  const ov = await loadOverlay('delta', { settings: { gapMode: 'track' } });
  const at = (g) => { st.relative = [{ idx: others[0].idx, gap: g }]; ov.render(st); };
  at(1.0); ov.advance(1000);
  at(0.95); ov.advance(1000);
  at(0.9);
  assert.equal(gap(ov, 'ahead').color, rgb(T.green));
  ov.advance(1000); at(1.2); ov.advance(1000); at(1.5);
  assert.equal(gap(ov, 'ahead').color, rgb(T.red));
  ov.close();
});

test('gap bars can be hidden', async () => {
  const ov = await loadOverlay('delta', { settings: { showGaps: false } });
  ov.render(withDelta([0, 0, true]));
  assert.equal(ov.$('.gaps').style.display, 'none');
  ov.close();
});

test('missing player or deltas: nothing rendered', async () => {
  const ov = await loadOverlay('delta');
  ov.renderRaw({ connected: true, session: {} });
  ov.renderRaw({ connected: true, session: {}, player: {} });
  assert.equal(ov.$('.val').textContent, '–');
  assert.deepEqual(ov.errors, []);
  ov.close();
});
