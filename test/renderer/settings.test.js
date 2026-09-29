const test = require('node:test');
const assert = require('node:assert/strict');
const Registry = require('../../src/shared/registry');
const { loadSettings } = require('../helpers/settings');

const lastGlobal = (sw) => { const c = sw.calls('settings:setGlobal'); return c[c.length - 1][0]; };
const lastOverlay = (sw) => { const c = sw.calls('settings:setOverlay'); return c[c.length - 1]; };
const fieldByLabel = (sw, text) => sw.$$('.field').find((f) => (f.querySelector('label') || {}).textContent === text);

// ---------------- nav ----------------

test('nav lists the main pages, including Class splits, and every overlay with a toggle', async () => {
  const sw = await loadSettings();
  const main = sw.$$('#nav-main a').map((a) => a.dataset.page);
  assert.deepEqual(main, ['home', 'appearance', 'general', 'classes', 'profiles']);
  assert.match(sw.$('#nav-main').textContent, /Class splits/);
  const ovs = sw.$$('#nav-overlays a');
  assert.deepEqual(ovs.map((a) => a.dataset.page), Registry.OVERLAYS.map((d) => 'ov:' + d.id));
  for (const a of ovs) assert.ok(a.querySelector('[data-toggle] input[type=checkbox]'));
  assert.match(sw.$('#profile-name').textContent, /v0\.0\.0-test/);
  assert.deepEqual(sw.errors, []);
  sw.close();
});

test('toggling an overlay in the nav sends settings:setOverlay {enabled}', async () => {
  const sw = await loadSettings();
  const cb = sw.$('#nav-overlays [data-toggle="flags"] input');
  const was = cb.checked;
  await sw.click(cb); // a click flips the checkbox, like a real one
  assert.deepEqual(lastOverlay(sw), ['flags', { enabled: !was }]);
  assert.equal(sw.config.profiles[sw.config.activeProfile].overlays.flags.enabled, !was);
  sw.close();
});

test('clicking a nav link switches the page', async () => {
  const sw = await loadSettings();
  await sw.go('general');
  assert.match(sw.$('#page h1').textContent, /General/);
  assert.ok(sw.$('#nav-main [data-page="general"]').classList.contains('active'));
  await sw.go('ov:relative');
  assert.match(sw.$('#page h1').textContent, /Relative/);
  sw.close();
});

// ---------------- every page renders ----------------

const PAGES = ['home', 'appearance', 'general', 'classes', 'profiles'].concat(Registry.OVERLAYS.map((d) => 'ov:' + d.id));
for (const page of PAGES) {
  test(`page ${page} renders without errors`, async () => {
    const sw = await loadSettings({ page });
    assert.ok(sw.$('#page').children.length > 0);
    assert.ok(sw.$('#page h1'));
    await sw.settle(300); // Class splits preview is debounced
    assert.deepEqual(sw.errors, []);
    sw.close();
  });
}

// ---------------- overlay page fields ----------------

test('overlay page renders one field per schema entry, by type', async () => {
  for (const d of Registry.OVERLAYS) {
    const sw = await loadSettings({ page: 'ov:' + d.id });
    for (const f of d.schema.concat(Registry.COMMON_SCHEMA)) {
      if (f.type === 'columns') { assert.ok(sw.$('.cols'), `${d.id}: columns editor`); continue; }
      const el = fieldByLabel(sw, f.label);
      assert.ok(el, `${d.id}: field "${f.label}"`);
      const want = { bool: 'input[type=checkbox]', number: 'input[type=number]', range: 'input[type=range]', color: 'input[type=color]', select: 'select', text: 'input[type=text]' }[f.type];
      assert.ok(el.querySelector(want), `${d.id}: "${f.label}" is a ${f.type}`);
      if (f.type === 'range') assert.ok(el.querySelector('input.rangebox'), `${d.id}: "${f.label}" has a number box`);
    }
    sw.close();
  }
});

test('editing each field type sends the right patch', async () => {
  const sw = await loadSettings({ page: 'ov:dash' });
  const bool = fieldByLabel(sw, 'Shift lights').querySelector('input');
  await sw.check(bool, false);
  assert.deepEqual(lastOverlay(sw), ['dash', { shiftLights: false }]);

  const num = fieldByLabel(sw, 'Number of lights').querySelector('input');
  await sw.input(num, '15');
  assert.deepEqual(lastOverlay(sw), ['dash', { lightCount: 15 }]);
  await sw.input(num, '99'); // above max 20
  assert.deepEqual(lastOverlay(sw), ['dash', { lightCount: 20 }]);

  const color = fieldByLabel(sw, 'Lock-up color').querySelector('input');
  await sw.input(color, '#123456');
  assert.deepEqual(lastOverlay(sw), ['dash', { lockColor: '#123456' }]);

  const sel = fieldByLabel(sw, 'Slip light position').querySelector('select');
  await sw.input(sel, 'start', 'change');
  assert.deepEqual(lastOverlay(sw), ['dash', { slipSide: 'start' }]);
  sw.close();
});

test('range slider and its number box stay in sync, and the box clamps to min / max', async () => {
  const sw = await loadSettings({ page: 'ov:dash' });
  const f = fieldByLabel(sw, 'Vertical padding (px)'); // min 0, max 30
  const range = f.querySelector('input[type=range]');
  const box = f.querySelector('input.rangebox');
  await sw.input(range, '12');
  assert.equal(box.value, '12');
  assert.deepEqual(lastOverlay(sw), ['dash', { padV: 12 }]);
  await sw.input(box, '500');
  assert.deepEqual(lastOverlay(sw), ['dash', { padV: 30 }]);
  assert.equal(range.value, '30');
  await sw.input(box, '-4');
  assert.deepEqual(lastOverlay(sw), ['dash', { padV: 0 }]);
  const n = sw.calls('settings:setOverlay').length;
  await sw.input(box, 'abc'); // not a number: ignored
  assert.equal(sw.calls('settings:setOverlay').length, n);
  sw.close();
});

test('text field and position fields send patches', async () => {
  const sw = await loadSettings({ page: 'ov:relative' });
  const w = fieldByLabel(sw, 'Width').querySelector('input');
  await sw.input(w, '512.4');
  const [id, patch] = lastOverlay(sw);
  assert.equal(id, 'relative');
  assert.equal(patch.bounds.width, 512);
  sw.close();
});

test('accent color field can be reset to the theme color', async () => {
  const sw = await loadSettings({ page: 'ov:standings' });
  const f = fieldByLabel(sw, 'Accent color override');
  const btn = f.querySelector('button');
  assert.equal(btn.textContent, 'Theme');
  await sw.input(f.querySelector('input'), '#ff0000');
  assert.equal(btn.textContent, 'Reset');
  await sw.click(btn);
  assert.deepEqual(lastOverlay(sw), ['standings', { accent: '' }]);
  sw.close();
});

test('columns editor: toggle and move up / down send the new column list', async () => {
  const sw = await loadSettings({ page: 'ov:relative' });
  const items = () => sw.$$('.col-item');
  const ids = () => lastOverlay(sw)[1].columns.map((c) => c.id);
  const first = items()[0].textContent;
  assert.match(first, /Position/);
  // move the 2nd column up
  await sw.click(items()[1].querySelectorAll('button')[0]);
  assert.deepEqual(ids().slice(0, 2), ['number', 'pos']);
  assert.match(items()[0].textContent, /Car number/);
  // move it back down
  await sw.click(items()[0].querySelectorAll('button')[1]);
  assert.deepEqual(ids().slice(0, 2), ['pos', 'number']);
  // switch a column off
  await sw.check(items()[0].querySelector('input'), false);
  assert.equal(lastOverlay(sw)[1].columns[0].on, false);
  assert.ok(items()[0].classList.contains('off'));
  // up on the first / down on the last do nothing
  const n = sw.calls('settings:setOverlay').length;
  await sw.click(items()[0].querySelectorAll('button')[0]);
  const last = items()[items().length - 1];
  await sw.click(last.querySelectorAll('button')[1]);
  assert.equal(sw.calls('settings:setOverlay').length, n);
  sw.close();
});

test('home quick sliders set opacity / background opacity', async () => {
  const sw = await loadSettings({ page: 'home' });
  const r = sw.$('.ov[data-page="ov:fuel"] .quick input[data-k="opacity"]');
  await sw.input(r, '40');
  assert.deepEqual(lastOverlay(sw), ['fuel', { opacity: 40 }]);
  assert.equal(r.nextElementSibling.textContent, '40%');
  sw.close();
});

// ---------------- header / general ----------------

test('demo toggle maps to dataSource auto / iracing', async () => {
  const sw = await loadSettings({ global: { dataSource: 'auto' } });
  const t = sw.$('#demo-toggle');
  assert.equal(t.checked, true);
  await sw.check(t, false);
  assert.deepEqual(lastGlobal(sw), { dataSource: 'iracing' });
  await sw.check(t, true);
  assert.deepEqual(lastGlobal(sw), { dataSource: 'auto' });
  sw.close();
  const sw2 = await loadSettings({ global: { dataSource: 'iracing' } });
  assert.equal(sw2.$('#demo-toggle').checked, false);
  sw2.close();
});

test('status pill and edit button follow settings:status', async () => {
  const sw = await loadSettings();
  assert.match(sw.$('#status').textContent, /Demo data/);
  sw.emit('settings:status', { source: 'iracing', track: 'Spa', editMode: true });
  assert.match(sw.$('#status').textContent, /Connected to iRacing · Spa/);
  assert.match(sw.$('#btn-edit').textContent, /Done editing/);
  await sw.click(sw.$('#btn-edit'));
  assert.deepEqual(sw.calls('settings:setEditMode').pop(), [false]);
  sw.close();
});

test('general page: speed unit select and other globals', async () => {
  const sw = await loadSettings({ page: 'general' });
  const sel = fieldByLabel(sw, 'Speed unit (all overlays)').querySelector('select');
  assert.equal(sel.value, 'auto');
  await sw.input(sel, 'mph', 'change');
  assert.deepEqual(lastGlobal(sw), { speedUnit: 'mph' });
  await sw.input(fieldByLabel(sw, 'Units (fuel, temperatures)').querySelector('select'), 'imperial', 'change');
  assert.deepEqual(lastGlobal(sw), { units: 'imperial' });
  await sw.check(fieldByLabel(sw, 'Show overlays while watching replays / spectating').querySelector('input'), true);
  assert.deepEqual(lastGlobal(sw), { showInReplays: true });
  // hotkeys render with Ctrl instead of CommandOrControl
  assert.ok(sw.$$('button.hk').some((b) => b.textContent === 'Ctrl+Shift+U'));
  sw.close();
});

test('general page shows hotkey registration errors', async () => {
  const sw = await loadSettings({ page: 'general', hotkeyErrors: ['Ctrl+Shift+E is taken'] });
  assert.match(sw.$('.warnbox').textContent, /Ctrl\+Shift\+E is taken/);
  sw.close();
});

// ---------------- class splits ----------------

const rules = (sw) => sw.config.global.classSplits;

test('class splits: empty state', async () => {
  const sw = await loadSettings({ page: 'classes' });
  assert.match(sw.$('#page').textContent, /No sub-classes yet/);
  assert.equal(sw.$$('.card.split').length, 0);
  sw.close();
});

test('class splits: Add sub-class creates an enabled rule', async () => {
  const sw = await loadSettings({ page: 'classes' });
  await sw.click(sw.$$('#page button').find((b) => /Add sub-class/.test(b.textContent)));
  assert.equal(rules(sw).length, 1);
  assert.equal(rules(sw)[0].on, true);
  assert.equal(rules(sw)[0].match, 'numbers');
  assert.equal(sw.$$('.card.split').length, 1);
  sw.close();
});

test('class splits: Pro / Am preset creates two GT3 rules', async () => {
  const sw = await loadSettings({ page: 'classes' });
  await sw.click(sw.$$('#page button').find((b) => /Preset/.test(b.textContent)));
  const r = lastGlobal(sw).classSplits;
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => [x.name, x.from, x.match]), [['GT3 Pro', 'GT3', 'numbers'], ['GT3 Am', 'GT3', 'rest']]);
  assert.equal(r[0].numbers, '1-99');
  assert.notEqual(r[0].id, r[1].id);
  assert.equal(sw.$$('.card.split').length, 2);
  sw.close();
});

function twoRules() {
  return [
    { id: 'r1', on: true, name: 'GT3 Pro', color: '#f97316', from: 'GT3', league: '', match: 'numbers', numbers: '1-99', drivers: '', irMin: '', irMax: '' },
    { id: 'r2', on: true, name: 'GT3 Am', color: '#a855f7', from: 'GT3', league: '', match: 'rest', numbers: '', drivers: '', irMin: '', irMax: '' },
  ];
}

test('class splits: editing name, numbers, league and match type sends classSplits', async () => {
  const sw = await loadSettings({ page: 'classes', global: { classSplits: twoRules() } });
  const card0 = () => sw.$$('.card.split')[0];
  await sw.input(card0().querySelector('.sn'), 'Pro');
  assert.equal(lastGlobal(sw).classSplits[0].name, 'Pro');
  assert.equal(lastGlobal(sw).classSplits[1].name, 'GT3 Am'); // others untouched
  await sw.input(fieldByLabel(sw, 'Car numbers').querySelector('input'), '1-49, 77');
  assert.equal(rules(sw)[0].numbers, '1-49, 77');
  assert.equal(rules(sw)[0].name, 'Pro'); // earlier edit kept
  await sw.input(card0().querySelectorAll('.field')[1].querySelector('input'), ' 1234 ');
  assert.equal(rules(sw)[0].league, '1234');
  await sw.input(card0().querySelector('.sc'), '#00ff00');
  assert.equal(rules(sw)[0].color, '#00ff00');
  // switching the match type redraws the card with the matching inputs
  await sw.input(fieldByLabel(sw, 'Car goes in when').querySelector('select'), 'irating', 'change');
  assert.equal(rules(sw)[0].match, 'irating');
  assert.ok(fieldByLabel(sw, 'iRating from (empty = no minimum)'));
  await sw.input(fieldByLabel(sw, 'iRating below (empty = no maximum)').querySelector('input'), '2000');
  assert.equal(rules(sw)[0].irMax, '2000');
  sw.close();
});

test('class splits: disabling a rule greys out its card', async () => {
  const sw = await loadSettings({ page: 'classes', global: { classSplits: twoRules() } });
  await sw.check(sw.$$('.card.split')[1].querySelector('.split-head input[type=checkbox]'), false);
  assert.equal(rules(sw)[1].on, false);
  assert.ok(sw.$$('.card.split')[1].classList.contains('off'));
  sw.close();
});

test('class splits: drivers textarea', async () => {
  const r = twoRules();
  r[1].match = 'drivers';
  r[1].drivers = 'Max Verstappen';
  const sw = await loadSettings({ page: 'classes', global: { classSplits: r } });
  const ta = sw.$$('.card.split')[1].querySelector('textarea');
  assert.equal(ta.value, 'Max Verstappen');
  await sw.input(ta, 'Max Verstappen\n123456');
  assert.equal(rules(sw)[1].drivers, 'Max Verstappen\n123456');
  sw.close();
});

test('class splits: move up / down and delete', async () => {
  const sw = await loadSettings({ page: 'classes', global: { classSplits: twoRules() } });
  const names = () => rules(sw).map((x) => x.name);
  await sw.click(sw.$$('.card.split')[1].querySelector('.up'));
  assert.deepEqual(names(), ['GT3 Am', 'GT3 Pro']);
  await sw.click(sw.$$('.card.split')[0].querySelector('.down'));
  assert.deepEqual(names(), ['GT3 Pro', 'GT3 Am']);
  const n = sw.calls('settings:setGlobal').length;
  await sw.click(sw.$$('.card.split')[0].querySelector('.up')); // already first
  await sw.click(sw.$$('.card.split')[1].querySelector('.down')); // already last
  assert.equal(sw.calls('settings:setGlobal').length, n);
  await sw.click(sw.$$('.card.split')[0].querySelector('.del'));
  assert.deepEqual(names(), ['GT3 Am']);
  assert.equal(sw.$$('.card.split').length, 1);
  sw.close();
});

test('class splits: edits after a text change are not lost when moving a rule', async () => {
  const sw = await loadSettings({ page: 'classes', global: { classSplits: twoRules() } });
  await sw.input(sw.$$('.card.split')[0].querySelector('.sn'), 'Renamed');
  await sw.click(sw.$$('.card.split')[0].querySelector('.down'));
  assert.deepEqual(rules(sw).map((x) => x.name), ['GT3 Am', 'Renamed']);
  sw.close();
});

test('class splits: preview table from settings:classes with league id and counts', async () => {
  const classes = {
    leagueId: 4242,
    drivers: [
      { name: 'B Driver', number: '12', userId: 2, irating: 2000, baseClass: 'GT3', baseColor: '#ffda59', split: 'GT3 Pro', splitColor: '#f97316' },
      { name: 'A Driver', number: '3', userId: 1, irating: 3000, baseClass: 'GT3', baseColor: '#ffda59', split: 'GT3 Am', splitColor: '#a855f7' },
      { name: 'C <b>Driver</b>', number: '7', userId: 3, irating: 1500, baseClass: 'LMP2', baseColor: '#33ceff', split: '', splitColor: '' },
    ],
  };
  const sw = await loadSettings({ page: 'classes', global: { classSplits: twoRules() }, classes });
  await sw.settle(350);
  const box = sw.$('.preview');
  assert.match(box.textContent, /League ID of this session: 4242/);
  assert.match(box.textContent, /GT3 Pro: 1/);
  assert.match(box.textContent, /GT3 Am: 1/);
  assert.match(box.textContent, /LMP2: 1/);
  const rows = sw.$$('.ptable tr').slice(1);
  assert.deepEqual(rows.map((r) => r.cells[0].textContent), ['#3', '#7', '#12']); // sorted by car number
  assert.match(rows[1].textContent, /stays/);
  assert.equal(rows[1].cells[1].textContent, 'C <b>Driver</b>'); // escaped
  // the class datalist is filled from the session
  assert.deepEqual(sw.$$('#class-names option').map((o) => o.value), ['GT3', 'LMP2']);
  // it asked main with the current rules
  assert.deepEqual(sw.calls('settings:classes').pop()[0].map((r) => r.id), ['r1', 'r2']);
  sw.close();
});

test('class splits: preview says "none" when not a league session', async () => {
  const sw = await loadSettings({ page: 'classes', classes: { leagueId: 0, drivers: [{ name: 'X', number: '1', userId: 1, irating: 1, baseClass: 'GT3', baseColor: '#fff', split: '', splitColor: '' }] } });
  await sw.settle(350);
  assert.match(sw.$('.preview').textContent, /none \(not a league session\)/);
  sw.close();
});

test('class splits: preview asks to join a session when there is no data', async () => {
  const sw = await loadSettings({ page: 'classes', classes: null });
  await sw.settle(350);
  assert.match(sw.$('.preview').textContent, /Join a session/);
  sw.close();
});

test('class splits: preview refreshes after an edit', async () => {
  const sw = await loadSettings({ page: 'classes', global: { classSplits: twoRules() }, classes: null });
  await sw.settle(350);
  const n = sw.calls('settings:classes').length;
  await sw.input(sw.$$('.card.split')[0].querySelector('.sn'), 'Pro!');
  await sw.settle(350);
  assert.ok(sw.calls('settings:classes').length > n);
  assert.equal(sw.calls('settings:classes').pop()[0][0].name, 'Pro!');
  sw.close();
});

// ---------------- profiles ----------------

test('profiles page lists profiles and saves a snapshot', async () => {
  const sw = await loadSettings({ page: 'profiles' });
  const profs = sw.$$('.card.profiles .prof');
  assert.equal(profs.length, Object.keys(sw.config.profiles).length);
  assert.match(profs[0].textContent, /Active/);
  assert.equal(profs[0].querySelector('input').value, 'Default');
  await sw.input(sw.$('.snapname'), 'Road race');
  await sw.click(sw.$$('#page button').find((b) => /Save layout as new profile/.test(b.textContent)));
  assert.deepEqual(sw.calls('settings:profile').pop(), ['snapshot', 'Road race']);
  assert.match(sw.$('.snapmsg').textContent, /Road race/);
  sw.close();
});

test('profiles page: rename, duplicate, export, new', async () => {
  const sw = await loadSettings({ page: 'profiles' });
  const row = sw.$$('.card.profiles .prof')[0];
  await sw.input(row.querySelector('input'), 'Mine', 'change');
  assert.deepEqual(sw.calls('settings:profile').pop(), ['rename', 'default', 'Mine']);
  await sw.click(row.querySelector('.dup'));
  assert.deepEqual(sw.calls('settings:profile').pop(), ['create', 'Default (copy)', 'default']);
  await sw.click(row.querySelector('.exp'));
  assert.deepEqual(sw.calls('settings:profile').pop(), ['export', 'default']);
  await sw.click(sw.$$('#page button').find((b) => /New profile/.test(b.textContent)));
  assert.deepEqual(sw.calls('settings:profile').pop(), ['create', 'Profile 2']);
  sw.close();
});
