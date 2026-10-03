const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');

// CarLeftRight: 1 clear, 2 car left, 3 car right, 4 both sides, 5 two left, 6 two right
const st = (state, cars) => ({ connected: true, radar: { state, cars: cars.map(([idx, meters]) => ({ idx, meters })) } });
// every drawn car with its centre in % of the field (x: 50 = our lane, y: 50 = level with us, smaller = ahead)
const cars = (ov) => ov.$$('.spt .car').map((el) => {
  const p = (k) => parseFloat(el.style[k]);
  return { kind: el.classList[1], x: p('left') + p('width') / 2, y: p('top') + p('height') / 2 };
});
const others = (ov) => cars(ov).filter((c) => c.kind !== 'me');
const side = (c) => (c.x < 49 ? 'L' : c.x > 51 ? 'R' : 'C');
const labels = (ov) => ov.$$('.spt .pct').map((e) => e.textContent);
const wash = (ov, s) => ov.$('.spt .wash.' + s).classList.contains('on');
const wrap = (ov) => ov.$('.spt');

test('a car on the left: drawn in the left lane at its distance, left side glows, overlap %', async () => {
  const ov = await loadOverlay('spotter');
  ov.renderRaw(st(2, [[7, -2.3]]));
  const [c] = others(ov);
  assert.equal(side(c), 'L');
  assert.equal(c.kind, 'close');
  assert.ok(c.y > 50, 'behind us: lower than our car');
  assert.ok(wash(ov, 'l') && !wash(ov, 'r'));
  assert.deepEqual(labels(ov), ['50%']); // nose at our middle: half a car
  const me = cars(ov).find((x) => x.kind === 'me');
  assert.ok(Math.abs(me.x - 50) < 0.1 && Math.abs(me.y - 50) < 0.1);
  assert.equal(wrap(ov).style.opacity, '1');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('right side, and a car exactly alongside is 100%', async () => {
  const ov = await loadOverlay('spotter');
  ov.renderRaw(st(3, [[4, 0]]));
  assert.equal(side(others(ov)[0]), 'R');
  assert.equal(others(ov)[0].y, 50);
  assert.deepEqual(labels(ov), ['100%']);
  assert.ok(wash(ov, 'r'));
  ov.close();
});

test('the spotter flag wins over our distance estimate: still drawn overlapping', async () => {
  const ov = await loadOverlay('spotter');
  ov.renderRaw(st(2, [[7, 6.5]])); // our distance says just clear ahead, iRacing says alongside
  assert.equal(side(others(ov)[0]), 'L');
  assert.deepEqual(labels(ov), ['5%']);
  ov.close();
});

test('cars on both sides: each keeps the side it was first seen on; three wide glows orange', async () => {
  const ov = await loadOverlay('spotter');
  ov.renderRaw(st(3, [[9, -3], [5, -12]])); // #9 arrives on the right
  ov.renderRaw(st(4, [[9, -1], [5, -3.5]])); // then #5 on the left
  const byY = others(ov).sort((a, b) => a.y - b.y);
  assert.deepEqual(byY.map(side), ['R', 'L']); // #9 (-1 m) right, #5 (-3.5 m) left
  assert.ok(wash(ov, 'l') && wash(ov, 'r'));
  assert.match(ov.$('.spt .wash.l').style.background, /249, 115, 22/); // #f97316
  ov.close();
});

test('two cars on one side: second one further out', async () => {
  const ov = await loadOverlay('spotter');
  ov.renderRaw(st(5, [[1, 2], [2, -2], [3, -15]]));
  const left = others(ov).filter((c) => side(c) === 'L').sort((a, b) => a.x - b.x);
  assert.equal(left.length, 2);
  assert.ok(left[0].x < left[1].x - 5);
  assert.equal(others(ov).filter((c) => side(c) === 'R').length, 0);
  assert.equal(others(ov).filter((c) => side(c) === 'C').length, 1, 'the far one behind stays in our lane');
  ov.close();
});

test('a car keeps its side for a while after it drops back, then eases to the centre', async () => {
  const ov = await loadOverlay('spotter');
  ov.renderRaw(st(2, [[7, -2]]));
  ov.advance(1000);
  ov.renderRaw(st(1, [[7, -9]])); // spotter clear: it fell behind
  assert.equal(side(others(ov)[0]), 'L');
  assert.equal(others(ov)[0].kind, 'far');
  ov.advance(6000);
  ov.renderRaw(st(1, [[7, -10]]));
  assert.equal(side(others(ov)[0]), 'C');
  ov.close();
});

test('close / far colors by distance; cars past the radius are not drawn', async () => {
  const ov = await loadOverlay('spotter', { settings: { range: 20, closeAt: 8 } });
  ov.renderRaw(st(1, [[3, -6], [4, 15], [5, 40]]));
  assert.deepEqual(others(ov).map((c) => c.kind).sort(), ['close', 'far']);
  ov.close();
});

test('hides when nobody is near (unless auto-hide is off); edit mode shows a preview', async () => {
  const ov = await loadOverlay('spotter');
  ov.renderRaw(st(1, [[3, -40]]));
  assert.equal(wrap(ov).style.opacity, '0');
  ov.configure({ autoHide: false });
  ov.renderRaw(st(1, []));
  assert.equal(wrap(ov).style.opacity, '1');
  ov.close();

  const ed = await loadOverlay('spotter', { editMode: true });
  ed.renderRaw(st(0, []));
  assert.equal(wrap(ed).style.opacity, '1');
  assert.ok(others(ed).length >= 3);
  assert.ok(others(ed).some((c) => side(c) === 'L'));
  ed.close();
});

test('overlap label and guides can be turned off', async () => {
  const ov = await loadOverlay('spotter', { settings: { showOverlap: false, guides: false } });
  ov.renderRaw(st(2, [[7, -1]]));
  assert.deepEqual(labels(ov), []);
  assert.equal(ov.$('.spt .guides').style.display, 'none');
  ov.close();
});

test('runs on the demo race without errors', async () => {
  const { state, step } = demoRace({ seconds: 200 });
  const ov = await loadOverlay('spotter', { settings: { autoHide: false } });
  ov.render(state);
  for (let i = 0; i < 40; i++) ov.render(step(0.5));
  assert.deepEqual(ov.errors, []);
  assert.equal(cars(ov).filter((c) => c.kind === 'me').length, 1);
  ov.close();
});
