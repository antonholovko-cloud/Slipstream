const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('../helpers/overlay');
const { demoRace } = require('../helpers/demo');

const splits = [
  { id: 'a', on: true, name: 'GT3 Pro', color: '#f97316', from: 'GT3', match: 'numbers', numbers: '1-50' },
  { id: 'b', on: true, name: 'GT3 Am', color: '#a855f7', from: 'GT3', match: 'rest' },
];

test('renders the player row and the configured number of cars ahead / behind', async () => {
  const { state } = demoRace();
  const ov = await loadOverlay('relative', { settings: { groupByClass: false, ahead: 3, behind: 2 } });
  ov.render(state);
  const rows = ov.$$('table.board tr');
  assert.equal(rows.length, 3 + 1 + 2);
  const player = ov.$$('tr.player');
  assert.equal(player.length, 1);
  assert.match(player[0].textContent, /You Driver/);
  assert.deepEqual(ov.errors, []);
  ov.close();
});

test('multiclass: groups cars into class blocks, player class first, with ahead/behind arrows', async () => {
  const { state } = demoRace();
  const ov = await loadOverlay('relative');
  ov.render(state);
  const heads = ov.$$('tr.class-head').map((r) => r.textContent.trim());
  assert.ok(heads.length >= 1);
  assert.equal(heads[0], 'GT3');
  const firstBlock = [];
  for (const tr of ov.$$('table.board tr').slice(1)) { if (tr.classList.contains('class-head')) break; firstBlock.push(tr); }
  assert.ok(firstBlock.some((tr) => tr.classList.contains('player')));
  // every non-player gap carries a direction arrow while grouped
  for (const td of ov.$$('tr:not(.player):not(.class-head) td.c-gap')) if (td.textContent.trim() !== '0.0') assert.match(td.textContent, /[▲▼]/);
  // class tag column is dropped while grouped (the block header names the class)
  assert.equal(ov.$$('td.c-class').length, 0);
  ov.close();
});

test('single class: no grouping and no class tag, same as before', async () => {
  const { state } = demoRace({ setup: (m) => { const gt3 = m.cars.find((c) => !c.pace && c.cls.short === 'GT3').cls; for (const c of m.cars) if (!c.pace) c.cls = gt3; m.buildSessionInfo(); } });
  const ov = await loadOverlay('relative');
  ov.render(state);
  assert.equal(ov.$$('tr.class-head').length, 0);
  assert.ok(ov.$$('td.c-class').every((td) => td.textContent === ''));
  assert.ok(ov.$$('td.c-gap').every((td) => !/[▲▼]/.test(td.textContent)));
  ov.close();
});

test('league splits: sub-class tags and per-sub-class positions', async () => {
  const { state } = demoRace({ global: { classSplits: splits } });
  const ov = await loadOverlay('relative', { settings: { groupByClass: false } });
  ov.render(state);
  const tags = ov.$$('td.c-class .tag').map((t) => t.textContent);
  assert.ok(tags.includes('GT3 Pro') || tags.includes('GT3 Am'));
  assert.match(ov.$('.footer').textContent, /P\d+\/8/); // 8 cars in GT3 Pro in the demo
  ov.close();
});

test('shows "Not on track" without a player car', async () => {
  const { state } = demoRace();
  const ov = await loadOverlay('relative');
  ov.render({ ...state, cars: state.cars.map((c) => ({ ...c, isPlayer: false })) });
  assert.match(ov.document.body.textContent, /Not on track/);
  ov.close();
});

test('country flag column: a flag per driver with a country, toggled off in settings', async () => {
  const { state } = demoRace();
  const ov = await loadOverlay('relative');
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

test('grouped: class headers count toward the rows, so the farthest cars give way, never the nearest', async () => {
  // practice with four classes (like an MX-5 / SR8 / Porsche / FR500S session)
  const { state } = demoRace();
  const st = structuredClone(state);
  const me = st.cars.find((c) => c.isPlayer);
  const others = st.cars.filter((c) => !c.isPlayer).slice(0, 8);
  const cls = [['sr8', 'SR8'], ['sr8', 'SR8'], ['sr8', 'SR8'], ['sr8', 'SR8'], ['p992', 'PORSCHE 992'], ['p992', 'PORSCHE 992'], ['fr', 'FR500S'], ['fr', 'FR500S']];
  others.forEach((c, i) => { [c.classId, c.className] = cls[i]; });
  me.classId = 'mx5'; me.className = 'MX-5';
  const gaps = [45.5, 10.5, -12.8, -27.2, 2.1, -3.2, 6.7, 60];
  st.relative = others.map((c, i) => ({ idx: c.idx, gap: gaps[i], lapDiff: 0 })).sort((a, b) => b.gap - a.gap);
  st.classes = [];
  const ov = await loadOverlay('relative', { settings: { ahead: 4, behind: 4 } });
  ov.render(st);
  const rows = ov.$$('table.board tr');
  assert.ok(rows.length <= 4 + 4 + 1, `${rows.length} rows`);
  const text = ov.$('table.board').textContent;
  const shown = (c) => text.includes(c.name);
  // the nearest car ahead in each direction is always there, including the FR500S at +6.7
  for (const i of [4, 5, 6, 1]) assert.ok(shown(others[i]), `${others[i].name} (${gaps[i]}) missing`);
  assert.ok(!shown(others[7]) && !shown(others[0]), 'the farthest cars made room for the headers');
  ov.close();
});
