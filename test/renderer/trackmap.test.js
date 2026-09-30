const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');
const { THEMES } = require('../../src/shared/registry');

const T = THEMES.carbon;
const race = demoRace();
const onTrack = race.state.cars.filter((c) => c.inWorld && c.pct >= 0);
const OPTS = { canvasSize: [320, 320] };

// dots are drawn as arc() + fill(); labels with fillText()
const arcs = (ov) => ov.ctx2d().calls.filter((c) => c[0] === 'arc');
const texts = (ov) => ov.ctx2d().ops.filter((o) => o.op === 'fillText');
const fills = (ov) => ov.ctx2d().ops.filter((o) => o.op === 'fill');

test('draws one dot per car on track, player last, with car numbers', async () => {
  const ov = await loadOverlay('trackmap', OPTS);
  ov.render(race.state);
  assert.equal(arcs(ov).length, onTrack.length);
  const labels = texts(ov).map((o) => o.args[0]);
  assert.deepEqual(labels.slice().sort(), onTrack.map((c) => String(c.number)).sort());
  const me = onTrack.find((c) => c.isPlayer);
  assert.equal(labels[labels.length - 1], String(me.number), 'player drawn on top');
  assert.equal(fills(ov).at(-1).fillStyle, T.accent);
  assert.equal(ov.headerRight(), 'Demo Raceway');
  assert.equal(ov.$('.center-msg').style.display, 'none');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('dots use class colors, or one color when classColors is off', async () => {
  const ov = await loadOverlay('trackmap', OPTS);
  ov.render(race.state);
  const cols = new Set(fills(ov).slice(0, -1).map((o) => o.fillStyle));
  assert.ok(cols.has('#33ceff') && cols.has('#ffda59'));
  ov.configure({ classColors: false });
  ov.render(race.state);
  const later = fills(ov).slice(-onTrack.length, -1).map((o) => o.fillStyle);
  assert.ok(later.every((c) => c === '#e5e7eb'));
  ov.close();
});

test('positions instead of numbers; no labels on small dots', async () => {
  const ov = await loadOverlay('trackmap', { ...OPTS, settings: { showPositions: true } });
  ov.render(race.state);
  const labels = texts(ov).map((o) => o.args[0]);
  assert.deepEqual(labels.slice().sort(), onTrack.map((c) => String(c.classPosition || '')).sort());
  ov.close();
  const small = await loadOverlay('trackmap', { ...OPTS, settings: { dotSize: 4 } });
  small.render(race.state);
  assert.equal(texts(small).length, 0);
  small.close();
  const none = await loadOverlay('trackmap', { ...OPTS, settings: { showNumbers: false } });
  none.render(race.state);
  assert.equal(texts(none).length, 0);
  none.close();
});

test('cars in the pits are drawn hollow (dark fill, class-colored ring)', async () => {
  const st = structuredClone(race.state);
  const car = st.cars.find((c) => !c.isPlayer && c.inWorld);
  car.onPitRoad = true;
  const ov = await loadOverlay('trackmap', OPTS);
  ov.render(st);
  assert.ok(fills(ov).some((o) => o.fillStyle === 'rgba(0,0,0,0.6)'));
  assert.ok(ov.ctx2d().ops.some((o) => o.op === 'stroke' && o.strokeStyle === car.classColor && o.lineWidth === 2));
  ov.close();
});

test('track outline uses the track color and width; start/finish line optional', async () => {
  const ov = await loadOverlay('trackmap', { ...OPTS, settings: { trackColor: '#123456', trackWidth: 9 } });
  ov.render(race.state);
  const strokes = ov.ctx2d().ops.filter((o) => o.op === 'stroke');
  assert.ok(strokes.some((o) => o.strokeStyle === '#123456' && o.lineWidth === 9));
  assert.ok(strokes.some((o) => o.strokeStyle === '#ffffff' && o.lineWidth === 3), 'start/finish');
  ov.close();
  const off = await loadOverlay('trackmap', { ...OPTS, settings: { showStartFinish: false } });
  off.render(race.state);
  assert.ok(!off.ctx2d().ops.some((o) => o.op === 'stroke' && o.strokeStyle === '#ffffff' && o.lineWidth === 3));
  off.close();
});

test('rotation and mirroring change the projected track', async () => {
  const outline = async (settings) => {
    const ov = await loadOverlay('trackmap', { ...OPTS, settings });
    ov.render(race.state);
    const pts = ov.ctx2d().calls.filter((c) => c[0] === 'lineTo').slice(0, 20).map((c) => c.slice(1).map((v) => v.toFixed(1)).join(','));
    ov.close();
    return pts.join(' ');
  };
  const base = await outline({});
  assert.notEqual(await outline({ rotate: 90 }), base);
  assert.notEqual(await outline({ mirror: true }), base);
});

test('unknown track: circle placeholder and learning progress', async () => {
  const st = structuredClone(race.state);
  st.trackMap = { id: 'x', points: null, learning: 0.4 };
  const ov = await loadOverlay('trackmap', OPTS);
  ov.render(st);
  assert.equal(ov.$('.center-msg').style.display, 'flex');
  assert.equal(ov.$('.center-msg').textContent, 'Learning track… 40%');
  assert.equal(arcs(ov).length, onTrack.length);
  st.trackMap.learning = 0;
  ov.render(st);
  assert.equal(ov.$('.center-msg').textContent, 'Drive a clean lap to learn this track');
  ov.close();
});

test('cars out of the world are not drawn', async () => {
  const st = structuredClone(race.state);
  st.cars.filter((c) => !c.isPlayer).slice(0, 3).forEach((c) => { c.inWorld = false; });
  const ov = await loadOverlay('trackmap', OPTS);
  ov.render(st);
  assert.equal(arcs(ov).length, onTrack.length - 3);
  ov.close();
});

test('canvas is sized to its box times the pixel ratio', async () => {
  const ov = await loadOverlay('trackmap', { canvasSize: [200, 150] });
  ov.window.devicePixelRatio = 2;
  ov.render(race.state);
  const c = ov.$('canvas');
  assert.deepEqual([c.width, c.height], [400, 300]);
  ov.close();
});
