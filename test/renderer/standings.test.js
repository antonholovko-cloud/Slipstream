const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');

const race = demoRace();
const cols = (ids) => ids.map((id) => ({ id, on: true }));

test('multiclass: one block per class with a header showing name, car count and SOF', async () => {
  const ov = await loadOverlay('standings', { settings: { maxRows: 30 } });
  ov.render(race.state);
  const heads = ov.$$('tr.class-head').map((r) => r.textContent);
  assert.equal(heads.length, 2);
  assert.match(heads[0], /LMP2.*8 cars.*SOF 2483/);
  assert.match(heads[1], /GT3.*14 cars.*SOF 3294/);
  assert.equal(ov.$$('tr.player').length, 1);
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('class headers can be hidden; grouping can be turned off', async () => {
  const ov = await loadOverlay('standings', { settings: { maxRows: 30, showClassHeader: false } });
  ov.render(race.state);
  assert.equal(ov.$$('tr.class-head').length, 0);
  ov.configure({ multiclass: false });
  ov.render(race.state);
  // single list sorted by overall position
  const pos = ov.$$('td.c-pos').map((td) => +td.textContent);
  assert.equal(pos.length, 22);
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b));
  ov.close();
});

test('rows within a class are in class-position order', async () => {
  const ov = await loadOverlay('standings', { settings: { maxRows: 30, columns: cols(['classPos', 'name']) } });
  ov.render(race.state);
  const rows = ov.$$('table.board tr');
  let block = [];
  const blocks = [];
  for (const r of rows) {
    if (r.classList.contains('class-head')) { if (block.length) blocks.push(block); block = []; continue; }
    block.push(+r.querySelector('.c-classPos').textContent);
  }
  blocks.push(block);
  for (const b of blocks) assert.deepEqual(b, b.map((_, i) => i + 1));
  ov.close();
});

test('maxRows limits each class', async () => {
  const ov = await loadOverlay('standings', { settings: { maxRows: 4, keepPlayerVisible: false } });
  ov.render(race.state);
  assert.equal(ov.$$('tr:not(.class-head)').length, 8);
  assert.equal(ov.$$('tr.sep').length, 0);
  ov.close();
});

test('keepPlayerVisible: top rows, a separator and a window around the player', async () => {
  // push the player down to P12 of the GT3 class
  const st = structuredClone(race.state);
  const gt3 = st.cars.filter((c) => c.className === 'GT3').sort((a, b) => a.classPosition - b.classPosition);
  const me = gt3.find((c) => c.isPlayer);
  const other = gt3[11];
  [me.classPosition, other.classPosition] = [other.classPosition, me.classPosition];
  const ov = await loadOverlay('standings', { settings: { maxRows: 6, topRows: 2, keepPlayerVisible: true, columns: cols(['classPos', 'name']) } });
  ov.render(st);
  assert.equal(ov.$$('tr.sep').length, 1);
  assert.equal(ov.$$('tr.player').length, 1);
  assert.match(ov.$('tr.player').textContent, /You Driver/);
  // rows in the GT3 block: 2 top + separator + 4 around the player
  const rows = ov.$$('table.board tr');
  const gtStart = rows.findIndex((r) => /GT3/.test(r.textContent) && r.classList.contains('class-head'));
  const gtRows = rows.slice(gtStart + 1);
  assert.equal(gtRows.length, 7);
  assert.deepEqual(gtRows.slice(0, 2).map((r) => r.querySelector('.c-classPos').textContent), ['1', '2']);
  ov.close();
});

test('columns follow the settings order and toggles', async () => {
  const ov = await loadOverlay('standings', { settings: { columns: [{ id: 'name', on: true }, { id: 'pos', on: true }, { id: 'irating', on: false }] } });
  ov.render(race.state);
  const first = ov.$('tr.player');
  assert.deepEqual([...first.children].map((td) => td.className), ['c-name', 'c-pos']);
  ov.close();
});

test('every column renders its cell', async () => {
  const all = ['pos', 'classPos', 'posGain', 'class', 'number', 'name', 'team', 'car', 'license', 'irating', 'irDelta', 'pit', 'lap', 'gap', 'interval', 'last', 'best', 'tire', 'bogus'];
  const ov = await loadOverlay('standings', { settings: { maxRows: 30, columns: cols(all) } });
  ov.render(race.state);
  const tr = ov.$('tr.player');
  assert.equal(tr.children.length, all.length);
  assert.match(tr.querySelector('.c-number').textContent, /^#\d+$/);
  assert.ok(tr.querySelector('.c-class .tag.cls'));
  assert.ok(tr.querySelector('.c-license .lic'));
  assert.match(tr.querySelector('.c-irating').textContent, /k$/);
  assert.match(tr.querySelector('.c-last').textContent, /^\d:\d\d\.\d{3}$/);
  assert.equal(tr.lastElementChild.textContent, '');
  ov.close();
});

test('leader shows "Leader"; posGain and irDelta are colored by sign', async () => {
  const st = structuredClone(race.state);
  const [a, b] = st.cars;
  a.posGain = 3; a.irDelta = 12;
  b.posGain = -2; b.irDelta = -7;
  const ov = await loadOverlay('standings', { settings: { maxRows: 30, multiclass: false, columns: cols(['name', 'posGain', 'irDelta', 'gap']) } });
  ov.render(st);
  const row = (car) => ov.$$('table.board tr').find((r) => r.textContent.includes(car.name));
  assert.equal(row(a).querySelector('.c-posGain').className, 'c-posGain green');
  assert.equal(row(a).querySelector('.c-posGain').textContent, '▲3');
  assert.equal(row(b).querySelector('.c-posGain').textContent, '▼2');
  assert.match(row(b).querySelector('.c-posGain').className, /red/);
  assert.equal(row(a).querySelector('.c-irDelta').textContent, '+12');
  assert.match(row(b).querySelector('.c-irDelta').className, /red/);
  assert.ok(ov.$$('td.c-gap').some((td) => td.textContent === 'Leader'));
  ov.close();
});

test('fastest lap is purple when highlightFastest is on', async () => {
  const st = structuredClone(race.state);
  const ov = await loadOverlay('standings', { settings: { maxRows: 30 } });
  ov.render(st);
  const purple = ov.$$('td.c-best.purple');
  assert.equal(purple.length, st.cars.filter((c) => c.fastest).length);
  assert.ok(purple.length >= 1);
  ov.configure({ highlightFastest: false });
  ov.render(st);
  assert.equal(ov.$$('td.purple').length, 0);
  ov.close();
});

test('pit and out-of-world cars are tagged; showOutOfCar hides them', async () => {
  const st = structuredClone(race.state);
  const others = st.cars.filter((c) => !c.isPlayer);
  others[0].onPitRoad = true;
  others[1].inWorld = false;
  const ov = await loadOverlay('standings', { settings: { maxRows: 30 } });
  ov.render(st);
  assert.equal(ov.$$('tr.inpit').length, 1);
  assert.ok(ov.$('tr.inpit .tag.pit'));
  assert.equal(ov.$$('tr.gone').length, 1);
  assert.ok(ov.$('tr.gone .tag.out'));
  ov.configure({ showOutOfCar: false });
  ov.render(st);
  assert.equal(ov.$$('tr.gone').length, 0);
  ov.close();
});

test('name formats apply', async () => {
  const ov = await loadOverlay('standings', { settings: { nameFormat: 'abbrev', maxRows: 30 } });
  ov.render(race.state);
  assert.equal(ov.$('tr.player .c-name').textContent, 'DRI');
  ov.close();
});

test('footer: SOF, lap x/total, car count; can be hidden', async () => {
  const ov = await loadOverlay('standings');
  ov.render(race.state);
  const f = ov.$('.footer');
  assert.match(f.textContent, /SOF 3294/);
  assert.match(f.textContent, /Lap \d+\/20/);
  assert.match(f.textContent, /22 cars/);
  assert.equal(ov.headerRight(), 'RACE');
  ov.configure({ footer: false });
  ov.render(race.state);
  assert.equal(f.style.display, 'none');
  ov.close();
});

test('timed session: footer shows time left', async () => {
  const st = structuredClone(race.state);
  st.session.timeRemain = 125;
  const ov = await loadOverlay('standings');
  ov.render(st);
  assert.match(ov.$('.footer').textContent, /2:05 left/);
  ov.close();
});

test('league splits: sub-class blocks', async () => {
  const split = demoRace({ global: { classSplits: [
    { id: 'a', on: true, name: 'GT3 Pro', color: '#f97316', from: 'GT3', match: 'numbers', numbers: '1-50' },
    { id: 'b', on: true, name: 'GT3 Am', color: '#a855f7', from: 'GT3', match: 'rest' },
  ] } });
  const ov = await loadOverlay('standings', { settings: { maxRows: 30 } });
  ov.render(split.state);
  const heads = ov.$$('tr.class-head').map((r) => r.textContent);
  assert.equal(heads.length, 3);
  assert.match(heads[1], /GT3 Pro/);
  assert.match(heads[2], /GT3 Am/);
  ov.close();
});

test('empty state renders an empty table without errors', async () => {
  const ov = await loadOverlay('standings');
  ov.renderRaw({ connected: true, cars: [], classes: [], session: {} });
  assert.equal(ov.$$('table.board tr').length, 0);
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('country flag column: a flag per driver with a country, toggled off in settings', async () => {
  const { state } = demoRace();
  const ov = await loadOverlay('standings');
  ov.render(state);
  const imgs = ov.$$('td.c-flag img.flag');
  assert.ok(imgs.length > 3);
  assert.ok(imgs.every((i) => /^flags\/[a-z-]+\.png$/.test(i.getAttribute('src'))));
  assert.ok(imgs.every((i) => i.title.length > 2), 'country name on hover');
  // drivers who keep the iRacing logo (no country) get an empty cell
  const st = structuredClone(state);
  st.cars.find((c) => c.isPlayer).flag = null;
  ov.render(st);
  assert.equal(ov.$('tr.player td.c-flag').innerHTML, '');
  ov.configure({ columns: ov.settings.columns.map((c) => (c.id === 'flag' ? { ...c, on: false } : c)) });
  ov.render(state);
  assert.equal(ov.$$('td.c-flag').length, 0);
  ov.close();
});
