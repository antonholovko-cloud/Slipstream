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
  Object.assign(st.player, { gear: 4, rpm: 5000, speed: 50, throttle: 0, brake: 0, slip: { learned: true, dev: 0, abs: false } }, p);
  Object.assign(st.session, session);
  return st;
}
const classic = (settings = {}) => loadOverlay('speed', { settings: { layout: 'classic', ...settings } });
const rev = (ov) => ov.$('.gearwrap .rev');
const blip = (ov) => ov.$('.gearwrap').classList.contains('blip');

test('speed, unit and gear', async () => {
  const ov = await classic();
  ov.render(withPlayer({ speed: 50, gear: 5 }));
  assert.equal(ov.$('.val b').textContent, '180');
  assert.equal(ov.$('.val small').textContent, 'km/h');
  assert.equal(ov.$('.gear').textContent, '5');
  ov.render(withPlayer({ gear: 0 }, { speedUnits: 'imperial' }));
  assert.equal(ov.$('.val b').textContent, '112');
  assert.equal(ov.$('.val small').textContent, 'mph');
  assert.equal(ov.$('.gear').textContent, 'N');
  ov.render(withPlayer({ gear: -1 }));
  assert.equal(ov.$('.gear').textContent, 'R');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('speed unit follows units when no separate speed unit is set', async () => {
  const ov = await classic();
  ov.render(withPlayer({ speed: 10 }, { units: 'imperial', speedUnits: undefined }));
  assert.equal(ov.$('.val small').textContent, 'mph');
  ov.close();
});

test('rev fill rises from the first-light rpm to the blue point, green / yellow / red', async () => {
  const ov = await classic(); // default blue point: 8300 - 300 = 8000
  ov.render(withPlayer({ rpm: 6000 }));
  assert.equal(parseFloat(rev(ov).style.height), 0);
  ov.render(withPlayer({ rpm: 7000 })); // 1/3 of 6500..8000
  assert.equal(parseFloat(rev(ov).style.height), 33.3);
  assert.equal(rev(ov).style.background, rgb(T.green));
  ov.render(withPlayer({ rpm: 7500 }));
  assert.equal(rev(ov).style.background, rgb(T.yellow));
  ov.render(withPlayer({ rpm: 7900 }));
  assert.equal(rev(ov).style.background, rgb(T.red));
  assert.equal(blip(ov), false);
  ov.close();
});

test('blue strobe at the over-rev point, in the limiter color', async () => {
  const ov = await classic({ limiterColor: '#00ffaa' });
  ov.render(withPlayer({ rpm: 8000 }));
  assert.equal(blip(ov), true);
  assert.equal(rev(ov).style.background, rgb('#00ffaa'));
  ov.render(withPlayer({ rpm: 7990 }));
  assert.equal(blip(ov), false);
  ov.close();
});

test('no strobe in neutral or reverse', async () => {
  const ov = await classic();
  ov.render(withPlayer({ rpm: 8200, gear: 0 }));
  assert.equal(blip(ov), false);
  ov.render(withPlayer({ rpm: 8200, gear: -1 }));
  assert.equal(blip(ov), false);
  ov.close();
});

test('limiterAt matches the dashboard choices', async () => {
  const at = async (limiterAt, rpm) => {
    const ov = await classic({ limiterAt });
    ov.render(withPlayer({ rpm }));
    const b = blip(ov);
    ov.close();
    return b;
  };
  assert.equal(await at('shift', 7699), false);
  assert.equal(await at('shift', 7700), true);
  assert.equal(await at('last', 7949), false);
  assert.equal(await at('last', 7950), true);
  assert.equal(await at('car', 8099), false);
  assert.equal(await at('car', 8100), true);
});

test('revIndicator "blip": no fill, strobe only', async () => {
  const ov = await classic({ revIndicator: 'blip' });
  ov.render(withPlayer({ rpm: 7500 }));
  assert.equal(parseFloat(rev(ov).style.height), 0);
  assert.equal(blip(ov), false);
  ov.render(withPlayer({ rpm: 8100 }));
  assert.equal(blip(ov), true);
  ov.close();
});

test('revIndicator "off": nothing, even over-rev', async () => {
  const ov = await classic({ revIndicator: 'off' });
  ov.render(withPlayer({ rpm: 8200 }));
  assert.equal(blip(ov), false);
  assert.equal(parseFloat(rev(ov).style.height), 0);
  ov.close();
});

test('slip lamp: spin / lock colors and labels, held briefly', async () => {
  const ov = await classic();
  const lamp = () => ov.$('.lamp');
  const label = () => ov.$('.lampbox small').textContent;
  ov.render(withPlayer({ throttle: 0.9, slip: { learned: true, dev: 0.12, abs: false } }));
  assert.ok(lamp().classList.contains('on'));
  assert.equal(ov.$('.spd').style.getPropertyValue('--slip'), '#f59e0b');
  assert.equal(label(), 'SPIN');
  ov.advance(20);
  ov.render(withPlayer({ brake: 0.9, slip: { learned: true, dev: -0.2, abs: false } }));
  assert.equal(label(), 'LOCK');
  assert.equal(ov.$('.spd').style.getPropertyValue('--slip'), '#ef4444');
  ov.advance(300);
  ov.render(withPlayer());
  assert.ok(!lamp().classList.contains('on'));
  assert.equal(label(), '');
  ov.close();
});

test('slip lamp: ABS counts as lock unless turned off; label can be hidden', async () => {
  const ov = await classic({ slipLabel: false });
  ov.render(withPlayer({ brake: 0.4, slip: { learned: true, dev: 0, abs: true } }));
  assert.ok(ov.$('.lamp').classList.contains('on'));
  assert.equal(ov.$('.lampbox small').textContent, '');
  ov.close();
  const ov2 = await classic({ lockOnAbs: false });
  ov2.render(withPlayer({ brake: 0.4, slip: { learned: true, dev: 0, abs: true } }));
  assert.ok(!ov2.$('.lamp').classList.contains('on'));
  ov2.close();
});

test('parts can be hidden', async () => {
  const ov = await classic({ showGear: false, showSlip: false, showUnit: false });
  for (const sel of ['.gearwrap', '.s1', '.lampbox', '.val small']) assert.equal(ov.$(sel).style.display, 'none', sel);
  ov.render(withPlayer({ gear: 3, rpm: 8200 }));
  assert.equal(ov.$('.gear').textContent, 'N', 'gear not updated when hidden');
  assert.equal(ov.$('.val small').textContent, '');
  ov.close();
});

test('auto-fit sets the font size from the natural size', async () => {
  const ov = await classic();
  ov.render(race.state);
  assert.match(ov.document.documentElement.style.getPropertyValue('--fs'), /^\d+(\.\d+)?px$/);
  ov.close();
});

// ---- side lights / light strip ----
const lit = (ov, sel) => [...ov.document.querySelectorAll(sel + ' i.on')].length;
const strobing = (ov) => ov.$('.spd').classList.contains('blip');

test('side lights are the default and fill both rails with rpm', async () => {
  const ov = await loadOverlay('speed'); // blue point 8000, first light 6500, 8 segments per rail
  assert.ok(ov.$('.spd').classList.contains('lay-rails'));
  ov.render(withPlayer({ rpm: 6000 }));
  assert.equal(lit(ov, '.rail.l'), 0);
  ov.render(withPlayer({ rpm: 7250 })); // half way
  assert.equal(lit(ov, '.rail.l'), 4);
  assert.equal(lit(ov, '.rail.r'), 4);
  ov.render(withPlayer({ rpm: 7990 }));
  assert.equal(lit(ov, '.rail.l'), 8);
  assert.equal(strobing(ov), false);
  assert.equal(parseFloat(rev(ov).style.height || 0), 0, 'no fill behind the gear');
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('side lights strobe in the limiter color at the strobe point, not in neutral', async () => {
  const ov = await loadOverlay('speed', { settings: { limiterAt: 'shift', limiterColor: '#00ffaa' } });
  ov.render(withPlayer({ rpm: 7700 }));
  assert.equal(strobing(ov), true);
  assert.equal(ov.$('.spd').style.getPropertyValue('--lim'), '#00ffaa');
  assert.equal(blip(ov), false, 'gear box does not strobe in this layout');
  ov.render(withPlayer({ rpm: 7700, gear: 0 }));
  assert.equal(strobing(ov), false);
  ov.close();
});

test('rev lights "blip" and "off" in the side lights layout', async () => {
  const b = await loadOverlay('speed', { settings: { revIndicator: 'blip' } });
  b.render(withPlayer({ rpm: 7500 }));
  assert.equal(lit(b, '.rail.l'), 0);
  b.render(withPlayer({ rpm: 8100 }));
  assert.equal(strobing(b), true);
  b.close();
  const o = await loadOverlay('speed', { settings: { revIndicator: 'off' } });
  o.render(withPlayer({ rpm: 8200 }));
  assert.equal(strobing(o), false);
  assert.equal(lit(o, '.rail.l'), 0);
  o.close();
});

test('light strip layout fills the strip', async () => {
  const ov = await loadOverlay('speed', { settings: { layout: 'strip' } });
  assert.ok(ov.$('.spd').classList.contains('lay-strip'));
  ov.render(withPlayer({ rpm: 7250 }));
  assert.equal(lit(ov, '.strip'), 7);
  ov.close();
});

test('slip in the new layouts: speed takes the slip color with a SPIN / LOCK tag', async () => {
  const ov = await loadOverlay('speed');
  const spd = () => ov.$('.spd');
  ov.render(withPlayer({ throttle: 0.9, slip: { learned: true, dev: 0.12, abs: false } }));
  assert.ok(spd().classList.contains('slip'));
  assert.ok(spd().classList.contains('tagged'));
  assert.equal(spd().style.getPropertyValue('--slip'), '#f59e0b');
  assert.equal(ov.$('.tag').textContent, 'SPIN');
  assert.ok(!ov.$('.lamp').classList.contains('on'), 'no lamp outside classic');
  ov.advance(300);
  ov.render(withPlayer());
  assert.ok(!spd().classList.contains('slip'));
  ov.close();
  const nolabel = await loadOverlay('speed', { settings: { slipLabel: false } });
  assert.ok(!nolabel.$('.spd').classList.contains('tagged'));
  nolabel.close();
});

test('switching layout clears what the old layout lit', async () => {
  const ov = await classic();
  ov.render(withPlayer({ rpm: 8200 }));
  assert.equal(blip(ov), true);
  ov.configure({ layout: 'rails' });
  assert.equal(blip(ov), false);
  ov.render(withPlayer({ rpm: 7250 }));
  assert.equal(lit(ov, '.rail.l'), 4);
  ov.close();
});

test('side lights: slip lanes on the outer edges, hidden with the slip warning', async () => {
  const ov = await loadOverlay('speed');
  const lanes = () => [...ov.document.querySelectorAll('.lane')];
  assert.equal(lanes().length, 2);
  assert.ok(ov.$('.side.l').firstElementChild.classList.contains('lane'), 'left lane outside the left rail');
  assert.ok(ov.$('.side.r').lastElementChild.classList.contains('lane'), 'right lane outside the right rail');
  ov.render(withPlayer({ brake: 0.9, slip: { learned: true, dev: -0.2, abs: false } }));
  assert.ok(ov.$('.spd').classList.contains('slip'));
  assert.equal(ov.$('.spd').style.getPropertyValue('--slip'), '#ef4444');
  ov.close();
  const off = await loadOverlay('speed', { settings: { showSlip: false } });
  for (const el of off.document.querySelectorAll('.lane')) assert.equal(el.style.display, 'none');
  off.close();
});
