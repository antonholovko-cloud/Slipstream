const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');
const { THEMES } = require('../../src/shared/registry');

const T = THEMES.carbon;
const race = demoRace();
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

// Demo car: first light 6500, shift 7700, all lit 7950, iRacing blink 8100, redline 8300.
function withPlayer(p = {}, session = {}) {
  const st = structuredClone(race.state);
  Object.assign(st.player, { gear: 4, rpm: 5000, speed: 50, throttle: 0, brake: 0, clutch: 0, steer: 0, abs: false, engineWarnings: 0,
    slip: { learned: true, dev: 0, abs: false } }, p);
  Object.assign(st.session, session);
  return st;
}
const lights = (ov) => ov.$$('.lights i:not(.slip)');
const litCount = (ov) => lights(ov).filter((i) => i.style.background).length;

test('gear, speed, unit and rpm readout', async () => {
  const ov = await loadOverlay('dash', { settings: { showRpm: true } });
  ov.render(withPlayer({ gear: 3, speed: 50, rpm: 6123.4 }));
  assert.equal(ov.$('.gear').textContent, '3');
  assert.equal(ov.$('.speed').firstChild.nodeValue, '180');
  assert.equal(ov.$('.speed small').textContent, 'km/h');
  assert.equal(ov.$('.rpm').firstChild.nodeValue, '6123');
  ov.render(withPlayer({ gear: 0 }));
  assert.equal(ov.$('.gear').textContent, 'N');
  ov.render(withPlayer({ gear: -1 }));
  assert.equal(ov.$('.gear').textContent, 'R');
  ov.render(withPlayer({ speed: 50 }, { speedUnits: 'imperial' }));
  assert.equal(ov.$('.speed').firstChild.nodeValue, '112');
  assert.equal(ov.$('.speed small').textContent, 'mph');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('rpm bar: width by redline, accent / yellow / red by stage', async () => {
  const ov = await loadOverlay('dash');
  const bar = () => ov.$('.rpmbar i');
  ov.render(withPlayer({ rpm: 4150 }));
  assert.equal(parseFloat(bar().style.width), 50);
  assert.equal(bar().style.background, rgb(T.accent));
  ov.render(withPlayer({ rpm: 7000 }));
  assert.equal(bar().style.background, rgb(T.yellow));
  ov.render(withPlayer({ rpm: 7800 }));
  assert.equal(bar().style.background, rgb(T.red));
  ov.close();
});

test('shift lights fill from the first-light rpm to all lit', async () => {
  const ov = await loadOverlay('dash', { settings: { lightCount: 12 } });
  assert.equal(lights(ov).length, 12);
  ov.render(withPlayer({ rpm: 6400 }));
  assert.equal(litCount(ov), 0);
  ov.render(withPlayer({ rpm: 6500 + (7950 - 6500) / 2 }));
  assert.equal(litCount(ov), 6);
  ov.render(withPlayer({ rpm: 7950 }));
  assert.equal(litCount(ov), 12);
  // green, then yellow, then red along the strip
  const cols = lights(ov).map((i) => i.style.background);
  assert.equal(cols[0], rgb(T.green));
  assert.equal(cols[6], rgb(T.yellow));
  assert.equal(cols[11], rgb(T.red));
  assert.ok(!ov.$('.lights').classList.contains('limiter'));
  ov.close();
});

test('blue strobe only at the over-rev point (default: 300 rpm below redline)', async () => {
  const ov = await loadOverlay('dash');
  const L = ov.$('.lights');
  ov.render(withPlayer({ rpm: 7990 }));
  assert.ok(!L.classList.contains('limiter'));
  assert.ok(!L.classList.contains('flash'), 'no flash before the blue stage by default');
  ov.render(withPlayer({ rpm: 8000 }));
  assert.ok(L.classList.contains('limiter'));
  assert.ok(lights(ov).every((i) => i.style.background === rgb('#38bdf8')));
  ov.close();
});

test('limiterAt options move the blue point', async () => {
  const at = async (limiterAt, rpm, extra = {}) => {
    const ov = await loadOverlay('dash', { settings: { limiterAt, ...extra } });
    ov.render(withPlayer({ rpm }));
    const on = ov.$('.lights').classList.contains('limiter');
    ov.close();
    return on;
  };
  assert.equal(await at('shift', 7699), false);
  assert.equal(await at('shift', 7700), true);
  assert.equal(await at('last', 7949), false);
  assert.equal(await at('last', 7950), true);
  assert.equal(await at('car', 8099), false);
  assert.equal(await at('car', 8100), true);
  assert.equal(await at('offset', 7799, { limiterRpm: 500 }), false);
  assert.equal(await at('offset', 7800, { limiterRpm: 500 }), true);
});

test('custom limiter color and flashOnShift between shift point and blue', async () => {
  const ov = await loadOverlay('dash', { settings: { flashOnShift: true, limiterColor: '#ff00ff' } });
  const L = ov.$('.lights');
  ov.render(withPlayer({ rpm: 7750 }));
  assert.ok(L.classList.contains('flash'));
  ov.render(withPlayer({ rpm: 8050 }));
  assert.ok(!L.classList.contains('flash'));
  assert.ok(L.classList.contains('limiter'));
  assert.equal(lights(ov)[0].style.background, rgb('#ff00ff'));
  ov.close();
});

test('slip light: wheelspin and lock-up with their colors, held briefly then off', async () => {
  const ov = await loadOverlay('dash');
  const slip = () => ov.$('.lights i.slip');
  assert.ok(slip().classList.contains('end'));
  ov.render(withPlayer({ throttle: 0.8, slip: { learned: true, dev: 0.1, abs: false } }));
  assert.ok(slip().classList.contains('on'));
  assert.equal(slip().title, 'Wheelspin');
  assert.equal(slip().style.getPropertyValue('--slip'), '#f59e0b');
  ov.advance(50);
  ov.render(withPlayer({ brake: 0.8, slip: { learned: true, dev: -0.2, abs: false } }));
  assert.equal(slip().title, 'Lock-up');
  assert.equal(slip().style.getPropertyValue('--slip'), '#ef4444');
  ov.advance(100);
  ov.render(withPlayer());
  assert.ok(slip().classList.contains('on'), 'held for ~180 ms');
  ov.advance(200);
  ov.render(withPlayer());
  assert.ok(!slip().classList.contains('on'));
  ov.close();
});

test('slip sensitivity thresholds and ABS', async () => {
  const ov = await loadOverlay('dash', { settings: { spinSensitivity: 10 } });
  const on = () => ov.$('.lights i.slip').classList.contains('on');
  ov.render(withPlayer({ throttle: 0.8, slip: { learned: true, dev: 0.08, abs: false } }));
  assert.equal(on(), false, 'below 10%');
  ov.render(withPlayer({ throttle: 0.05, slip: { learned: true, dev: 0.2, abs: false } }));
  assert.equal(on(), false, 'no throttle: not wheelspin');
  ov.render(withPlayer({ throttle: 0.8, slip: { learned: false, dev: 0.5, abs: false } }));
  assert.equal(on(), false, 'not learned yet');
  ov.render(withPlayer({ brake: 0.3, slip: { learned: true, dev: 0, abs: true } }));
  assert.equal(on(), true, 'ABS working counts as lock-up');
  ov.close();
  const ov2 = await loadOverlay('dash', { settings: { lockOnAbs: false } });
  ov2.render(withPlayer({ brake: 0.3, slip: { learned: true, dev: 0, abs: true } }));
  assert.equal(ov2.$('.lights i.slip').classList.contains('on'), false);
  ov2.close();
});

test('slip light position and removal', async () => {
  const ov = await loadOverlay('dash', { settings: { slipSide: 'start' } });
  assert.ok(ov.$('.lights').firstElementChild.classList.contains('slip'));
  assert.ok(ov.$('.lights i.slip').classList.contains('start'));
  ov.configure({ slipLight: false });
  assert.equal(ov.$('.lights i.slip'), null);
  ov.configure({ shiftLights: false, slipLight: false });
  assert.equal(ov.$('.lights').style.display, 'none');
  ov.configure({ slipLight: true });
  assert.equal(ov.$('.lights').style.display, '');
  // one light wide: 1/13 of the strip (jsdom simplifies the calc())
  assert.match(ov.$('.lights i.slip').style.flex, /calc\((100% \/ 13|7\.69\d*%)\)/);
  ov.close();
});

test('pedal trace: brake line turns the lock color where a wheel locked', async () => {
  const ov = await loadOverlay('dash');
  const locked = withPlayer({ brake: 0.9, slip: { learned: true, dev: -0.3, abs: false } });
  ov.render(locked); ov.advance(16);
  ov.render(locked); ov.advance(16);
  const strokes = ov.ctx2d().ops.filter((o) => o.op === 'stroke').map((o) => o.strokeStyle);
  assert.ok(strokes.includes('#facc15'), 'lock color on the brake line');
  assert.ok(strokes.includes('#22c55e'), 'throttle line');
  assert.ok(strokes.includes('#3b82f6'), 'clutch line');
  ov.close();
});

test('pedal trace: lock coloring can be turned off; ABS color; steering trace', async () => {
  const ov = await loadOverlay('dash', { settings: { traceLock: false, showSteerTrace: true, showClutch: false } });
  const st = withPlayer({ brake: 0.9, abs: true, slip: { learned: true, dev: -0.3, abs: true } });
  ov.render(st); ov.advance(16);
  ov.render(st);
  const strokes = ov.ctx2d().ops.filter((o) => o.op === 'stroke').map((o) => o.strokeStyle);
  assert.ok(!strokes.includes('#facc15'));
  assert.ok(strokes.includes('#f59e0b'), 'ABS color');
  assert.ok(strokes.includes('#e5e7eb'), 'steering trace');
  assert.ok(!strokes.includes('#3b82f6'), 'no clutch trace');
  ov.close();
});

test('pedal bars show inputs; brake bar uses the ABS color while ABS works', async () => {
  const ov = await loadOverlay('dash');
  ov.render(withPlayer({ throttle: 0.75, brake: 0.25, clutch: 1 }));
  assert.equal(parseFloat(ov.$('.b-th i').style.height), 75);
  assert.equal(parseFloat(ov.$('.b-br i').style.height), 25);
  assert.equal(parseFloat(ov.$('.b-cl i').style.height), 100);
  assert.equal(ov.$('.b-th span').textContent, '75');
  assert.equal(ov.$('.b-br i').style.background, rgb('#ef4444'));
  ov.render(withPlayer({ brake: 0.5, abs: true }));
  assert.equal(ov.$('.b-br i').style.background, rgb('#f59e0b'));
  ov.close();
});

test('steering wheel rotates by the steering angle (left = counter-clockwise)', async () => {
  const ov = await loadOverlay('dash', { settings: { smoothSteering: false, showSteerAngle: true } });
  ov.render(withPlayer({ steer: Math.PI / 2 })); // 90° to the left
  ov.flushFrames();
  assert.equal(ov.$('.wheel .rot').getAttribute('transform'), 'rotate(-90.00)');
  assert.equal(ov.$('.wheel .ang').textContent, '◀ 90°');
  ov.render(withPlayer({ steer: -Math.PI / 4 }));
  ov.flushFrames();
  assert.equal(ov.$('.wheel .rot').getAttribute('transform'), 'rotate(45.00)');
  assert.equal(ov.$('.wheel .ang').textContent, '▶ 45°');
  ov.render(withPlayer({ steer: 0 }));
  assert.equal(ov.$('.wheel .ang').textContent, '0°');
  ov.close();
});

test('smooth steering eases toward the target over frames', async () => {
  const ov = await loadOverlay('dash');
  ov.render(withPlayer({ steer: -Math.PI / 2 })); // +90°
  ov.flushFrames();
  const first = parseFloat(ov.$('.wheel .rot').getAttribute('transform').slice(7));
  assert.ok(first > 0 && first < 90);
  ov.flushFrames(40);
  assert.equal(ov.$('.wheel .rot').getAttribute('transform'), 'rotate(90.00)');
  ov.close();
});

for (const style of ['gt', 'rs50', 'round', 'formula', 'ring']) {
  test(`wheel style ${style} renders a rotating wheel`, async () => {
    const ov = await loadOverlay('dash', { settings: { wheelStyle: style } });
    assert.ok(ov.$('.wheel svg g.rot'));
    ov.close();
  });
}

test('steering bar style moves a knob instead of rotating', async () => {
  const ov = await loadOverlay('dash', { settings: { wheelStyle: 'bar' } });
  ov.render(withPlayer({ steer: -7.85 / 4, steerMax: 7.85 })); // half right
  assert.equal(ov.$('.steerbar .knob').getAttribute('cx'), '21.5');
  assert.equal(ov.$('.steerbar .fill').getAttribute('width'), '21.5');
  assert.equal(ov.$('.steerbar .fill').getAttribute('x'), '0.0');
  ov.render(withPlayer({ steer: 7.85 })); // full left, clamped
  assert.equal(ov.$('.steerbar .knob').getAttribute('cx'), '-43.0');
  assert.equal(ov.$('.steerbar .fill').getAttribute('x'), '-43.0');
  ov.close();
});

test('switching wheel style swaps the artwork', async () => {
  const ov = await loadOverlay('dash');
  const before = ov.$('.wheel').innerHTML;
  ov.configure({ wheelStyle: 'formula' });
  assert.notEqual(ov.$('.wheel').innerHTML, before);
  ov.configure({ wheelStyle: 'bar' });
  assert.ok(ov.$('.wheel .steerbar'));
  ov.close();
});

test('blocks can be switched off', async () => {
  const ov = await loadOverlay('dash', { settings: { showGear: false, showRpmBar: false, showTrace: false, showBars: false, showSteering: false,
    showLapInfo: false, showFuel: false, showBias: false, showWarnings: false } });
  const hidden = (sel) => ov.$(sel).style.display === 'none';
  for (const sel of ['.gearbox', '.rpmbar', 'canvas.trace', '.bars', '.wheel', '.s1', '.s2', '.foot']) assert.ok(hidden(sel), sel);
  ov.configure({ showTrace: true });
  assert.ok(!hidden('canvas.trace'));
  ov.configure({ showClutch: false, showBars: true });
  assert.ok(hidden('.b-cl'));
  assert.ok(!hidden('.bars'));
  ov.close();
});

test('vertical padding setting', async () => {
  const ov = await loadOverlay('dash', { settings: { padV: 12 } });
  assert.equal(ov.$('.dash').style.getPropertyValue('--padv'), '12px');
  ov.close();
});

test('footer: lap, last, best, delta, fuel and brake bias', async () => {
  const ov = await loadOverlay('dash', { settings: { showLapInfo: true, showFuel: true, showBias: true, showWarnings: true } });
  const st = withPlayer({ lap: 5, lastLap: 71.5, bestLap: 70.9, fuel: 26.44, brakeBias: 54.5 });
  st.player.deltas.best = [-0.12, 0, true];
  ov.render(st);
  const info = ov.$('.info').textContent;
  assert.match(info, /Lap 5\/20/);
  assert.match(info, /Last 1:11\.500/);
  assert.match(info, /Best 1:10\.900/);
  assert.match(info, /Δ -0\.12/);
  assert.match(info, /Fuel 26\.4 L/);
  assert.match(info, /Bias 54\.5%/);
  assert.match(ov.$('.info b.green').textContent, /-0\.12/);
  st.player.deltas.best = [0.3, 0, true];
  ov.render(st);
  assert.ok(ov.$('.info b.red'));
  st.player.deltas.best = [0, 0, false];
  ov.render(st);
  assert.match(ov.$('.info').textContent, /Δ –/);
  ov.close();
});

test('warnings: pit limiter first, then engine warnings', async () => {
  const ov = await loadOverlay('dash', { settings: { showLapInfo: true, showFuel: true, showBias: true, showWarnings: true } });
  ov.render(withPlayer({ engineWarnings: 0x10 | 0x01 | 0x04 }));
  const w = ov.$$('.warn span').map((s) => s.textContent);
  assert.deepEqual(w, ['PIT LIMITER', 'WATER', 'OIL P']);
  assert.ok(ov.$('.warn span.lim'));
  ov.render(withPlayer({ engineWarnings: 0 }));
  assert.equal(ov.$$('.warn span').length, 0);
  ov.close();
});

test('fit() reports a natural size and whether to fit the height', async () => {
  const ov = await loadOverlay('dash', { settings: { fitHeight: true } });
  ov.render(race.state);
  // Host.applyFontSize sets --fs from fit(); dash always has an autoFit size
  assert.match(ov.document.documentElement.style.getPropertyValue('--fs'), /px$/);
  ov.close();
});

test('no player slice: nothing happens', async () => {
  const ov = await loadOverlay('dash');
  ov.renderRaw({ connected: true, session: {} });
  assert.equal(ov.$('.gear').textContent, 'N');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('demo race renders without errors', async () => {
  const ov = await loadOverlay('dash');
  for (let i = 0; i < 5; i++) { ov.render(race.step(0.1)); ov.flushFrames(); ov.advance(16); }
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('by default: no bottom row and no RPM number', async () => {
  const ov = await loadOverlay('dash');
  assert.equal(ov.$('.foot').style.display, 'none');
  assert.equal(ov.$('.rpm').style.display, 'none');
  assert.notEqual(ov.$('.rpmbar').style.display, 'none', 'the RPM bar stays');
  ov.close();
});
