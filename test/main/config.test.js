const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// config.js needs electron's `app` only for its data paths: point them at temp dirs.
const paths = { userData: '', appData: '' };
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: (name) => paths[name] } };
  return realLoad.call(this, req, ...rest);
};
const { ConfigStore, migrate } = require('../../src/main/config');
const Registry = require('../../src/shared/registry');

function freshDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-cfg-'));
  paths.appData = path.join(root, 'appData');
  paths.userData = path.join(paths.appData, 'Slipstream');
  fs.mkdirSync(paths.userData, { recursive: true });
  return paths.userData;
}
const cfgFile = () => path.join(paths.userData, 'overlay-config.json');
const writeCfg = (obj) => fs.writeFileSync(cfgFile(), JSON.stringify(obj));
const quiet = (fn) => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };
function store() {
  const s = new ConfigStore();
  s.save = () => s.saveNow(); // no debounce timers left behind in tests
  return s;
}

// ---------------- migrate ----------------

test('migrate: empty config gets every default', () => {
  const m = migrate({});
  assert.equal(m.version, 1);
  assert.equal(m.activeProfile, 'default');
  assert.equal(m.global.theme, 'carbon');
  assert.deepEqual(m.global.classSplits, []);
  assert.equal(m.global.masterOpacity, 100);
  assert.equal(m.global.autoUpdate, null);
  assert.deepEqual(m.trackMaps, {});
  const ov = m.profiles.default.overlays;
  for (const def of Registry.OVERLAYS) {
    assert.ok(ov[def.id], 'overlay ' + def.id);
    assert.deepEqual(ov[def.id].bounds, def.bounds);
  }
});

test('migrate: keeps user values and fills in missing keys', () => {
  const m = migrate({ global: { theme: 'neon', hotkeys: { toggleEdit: 'F9' } }, profiles: { x: { name: 'Mine', overlays: { relative: { ahead: 2, bounds: { x: 5 } } } } }, activeProfile: 'x' });
  assert.equal(m.global.theme, 'neon');
  assert.equal(m.global.units, 'auto');
  assert.equal(m.global.hotkeys.toggleEdit, 'F9');
  assert.equal(m.global.hotkeys.toggleVisible, 'CommandOrControl+Shift+H', 'other hotkeys filled in');
  const rel = m.profiles.x.overlays.relative;
  assert.equal(rel.ahead, 2);
  assert.equal(rel.behind, 4);
  assert.equal(rel.bounds.x, 5);
  assert.equal(rel.bounds.width, Registry.byId('relative').bounds.width, 'missing bounds keys filled');
});

test('migrate: unknown active profile falls back to the first one; trackMaps kept', () => {
  const m = migrate({ activeProfile: 'gone', profiles: { a: { name: 'A' } }, trackMaps: { t: [1, 2] } });
  assert.equal(m.activeProfile, 'a');
  assert.deepEqual(m.trackMaps, { t: [1, 2] });
});

test('migrate: empty profiles object is replaced by the default profile', () => {
  const m = migrate({ profiles: {} });
  assert.deepEqual(Object.keys(m.profiles), ['default']);
});

test('migrate: merges the old separate Inputs overlay into the Dashboard', () => {
  const m = migrate({ profiles: { p: { name: 'P', overlays: {
    dash: { enabled: true, bounds: { x: 300, y: 900, width: 400, height: 200 }, fps: 30 },
    inputs: { enabled: true, bounds: { x: 100, y: 950, width: 300, height: 100 }, traceSeconds: 9, throttleColor: '#00ff00', fps: 60 },
  } } } });
  const d = m.profiles.p.overlays.dash;
  assert.equal(m.profiles.p.overlays.inputs, undefined);
  assert.equal(d.traceSeconds, 9);
  assert.equal(d.throttleColor, '#00ff00');
  assert.equal(d.bounds.x, 100, 'top-left of the pair');
  assert.equal(d.bounds.y, 900);
  assert.equal(d.bounds.width, 580, 'grown to fit');
  assert.equal(d.bounds.height, 116);
  assert.equal(d.fps, 60);
  assert.equal(d.layoutV2, true);
  assert.equal(d.enabled, true);
});

test('migrate: Inputs was on and Dashboard off -> dashboard takes the inputs position', () => {
  const m = migrate({ profiles: { p: { name: 'P', overlays: {
    dash: { enabled: false, bounds: { x: 1, y: 1, width: 600, height: 120 } },
    inputs: { enabled: true, bounds: { x: 700, y: 800, width: 300, height: 100 } },
  } } } });
  const d = m.profiles.p.overlays.dash;
  assert.equal(d.enabled, true);
  assert.equal(d.bounds.x, 700);
  assert.equal(d.bounds.y, 800);
});

test('migrate: Inputs was off -> its parts are switched off in the dashboard', () => {
  const m = migrate({ profiles: { p: { name: 'P', overlays: { dash: { enabled: true }, inputs: { enabled: false } } } } });
  const d = m.profiles.p.overlays.dash;
  assert.equal(d.showTrace, false);
  assert.equal(d.showBars, false);
  assert.equal(d.showSteering, false);
});

test('migrate: compactDash shrinks a tall v0.2.0 dashboard once', () => {
  const tall = migrate({ profiles: { p: { name: 'P', overlays: { dash: { bounds: { x: 0, y: 0, width: 600, height: 240 } } } } } });
  assert.equal(tall.profiles.p.overlays.dash.bounds.height, 116);
  assert.equal(tall.profiles.p.overlays.dash.layoutV2, true);
  const done = migrate({ profiles: { p: { name: 'P', overlays: { dash: { layoutV2: true, bounds: { x: 0, y: 0, width: 600, height: 240 } } } } } });
  assert.equal(done.profiles.p.overlays.dash.bounds.height, 240, 'already migrated: untouched');
});

test('migrate: flashV2 switches the shift flash off once', () => {
  const m = migrate({ profiles: { p: { name: 'P', overlays: { dash: { flashOnShift: true } } } } });
  assert.equal(m.profiles.p.overlays.dash.flashOnShift, false);
  assert.equal(m.profiles.p.overlays.dash.flashV2, true);
  const again = migrate({ profiles: { p: { name: 'P', overlays: { dash: { flashOnShift: true, flashV2: true } } } } });
  assert.equal(again.profiles.p.overlays.dash.flashOnShift, true);
});

test('migrate: radar ring look applied once to a legacy radar entry', () => {
  const m = migrate({ profiles: { p: { name: 'P', overlays: { radar: { fill: true, border: false, guides: true } } } } });
  assert.deepEqual({ ...m.profiles.p.overlays.radar }, { fill: false, border: true, guides: false, radarV3: true });
  const kept = migrate({ profiles: { p: { name: 'P', overlays: { radar: { fill: true, radarV3: true } } } } });
  assert.equal(kept.profiles.p.overlays.radar.fill, true);
});

test('migrate: deltaGaps makes room for the gap bars once', () => {
  const m = migrate({ profiles: { p: { name: 'P', overlays: { delta: { bounds: { x: 0, y: 0, width: 400, height: 60 } } } } } });
  assert.equal(m.profiles.p.overlays.delta.bounds.height, 110);
  assert.equal(m.profiles.p.overlays.delta.deltaV2, true);
  const big = migrate({ profiles: { p: { name: 'P', overlays: { delta: { bounds: { x: 0, y: 0, width: 400, height: 150 } } } } } });
  assert.equal(big.profiles.p.overlays.delta.bounds.height, 150);
  const done = migrate({ profiles: { p: { name: 'P', overlays: { delta: { deltaV2: true, bounds: { x: 0, y: 0, width: 400, height: 60 } } } } } });
  assert.equal(done.profiles.p.overlays.delta.bounds.height, 60);
});

test('migrate: flags are switched off once and lose the old animate option', () => {
  const m = migrate({ profiles: { p: { name: 'P', overlays: { flags: { enabled: true, animate: true } } } } });
  const f = m.profiles.p.overlays.flags;
  assert.equal(f.enabled, false);
  assert.equal(f.animate, undefined);
  assert.equal(f.flagsV2, true);
  const on = migrate({ profiles: { p: { name: 'P', overlays: { flags: { enabled: true, flagsV2: true } } } } });
  assert.equal(on.profiles.p.overlays.flags.enabled, true, 'turned back on by the user: stays on');
});

test('migrate: limiterOffset moves the old "car" limiter default to "offset" once', () => {
  const car = migrate({ profiles: { p: { name: 'P', overlays: { dash: { limiterAt: 'car' } } } } });
  assert.equal(car.profiles.p.overlays.dash.limiterAt, 'offset');
  const last = migrate({ profiles: { p: { name: 'P', overlays: { dash: { limiterAt: 'last' } } } } });
  assert.equal(last.profiles.p.overlays.dash.limiterAt, 'last', 'a real choice is kept');
  const chosen = migrate({ profiles: { p: { name: 'P', overlays: { dash: { limiterAt: 'car', limiterV2: true } } } } });
  assert.equal(chosen.profiles.p.overlays.dash.limiterAt, 'car', 'picked after the migration: kept');
});

test('migrate: columns keep user order/toggles, drop unknown ids and insert new ones after their default predecessor', () => {
  const user = [{ id: 'gap', on: true }, { id: 'name', on: false }, { id: 'bogus', on: true }, { id: 'number', on: true }, { id: 'pos', on: true }];
  const m = migrate({ profiles: { p: { name: 'P', overlays: { relative: { columns: user } } } } });
  const cols = m.profiles.p.overlays.relative.columns;
  const ids = cols.map((c) => c.id);
  assert.ok(!ids.includes('bogus'));
  // every known column present exactly once
  const known = Registry.byId('relative').schema.find((f) => f.key === 'columns').columns.map((c) => c.id);
  assert.deepEqual([...ids].sort(), [...known].sort());
  // user order kept for known columns
  assert.ok(ids.indexOf('gap') < ids.indexOf('name'));
  assert.ok(ids.indexOf('name') < ids.indexOf('number'));
  // new "class" column lands right after "number" (its default predecessor)
  assert.equal(ids[ids.indexOf('number') + 1], 'class');
  assert.equal(cols.find((c) => c.id === 'name').on, false, 'toggle kept');
});

test('migrate: a new first column goes to the front; a column whose predecessor is missing goes to the end', () => {
  const m = migrate({ profiles: { p: { name: 'P', overlays: { relative: { columns: [{ id: 'gap', on: true }] } } } } });
  const ids = m.profiles.p.overlays.relative.columns.map((c) => c.id);
  assert.equal(ids[0], 'pos', 'first default column inserted at index 0');
  assert.ok(ids.includes('gap'));
});

// ---------------- ConfigStore ----------------

test('ConfigStore: starts with defaults when there is no file, and does not create one until saved', () => {
  freshDirs();
  const s = store();
  assert.equal(s.data.activeProfile, 'default');
  assert.equal(fs.existsSync(cfgFile()), false);
  assert.deepEqual(s.listBackups(), []);
  s.saveNow();
  assert.ok(fs.existsSync(cfgFile()));
  assert.ok(s.lastSaved > 0);
});

test('ConfigStore: save / load roundtrip and migration persisted on startup', () => {
  freshDirs();
  writeCfg({ global: { theme: 'glass' }, profiles: { default: { name: 'Default', overlays: { relative: { ahead: 1 } } } } });
  const s = store();
  assert.equal(s.data.global.theme, 'glass');
  assert.equal(s.overlay('relative').ahead, 1);
  clearTimeout(s.saveTimer); // constructor queued a debounced save
  s.saveNow();
  const onDisk = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.ok(onDisk.profiles.default.overlays.standings, 'migrated overlays written back');
  assert.equal(fs.existsSync(cfgFile() + '.tmp'), false, 'atomic save leaves no temp file');
});

test('ConfigStore: corrupted file falls back to defaults (and is backed up first)', () => {
  freshDirs();
  fs.writeFileSync(cfgFile(), '{ not json');
  const s = quiet(() => store());
  clearTimeout(s.saveTimer);
  assert.equal(s.data.global.theme, 'carbon');
  assert.equal(s.listBackups().length, 1, 'broken file kept as a startup backup');
});

test('ConfigStore: onSaved callback fires on save', () => {
  freshDirs();
  const s = store();
  let n = 0;
  s.onSaved = () => n++;
  s.saveNow();
  assert.equal(n, 1);
});

// BUG (src/main/config.js setOverlay): Object.assign(cur, patch) swaps in patch.bounds before the bounds
// merge, so a partial bounds patch loses the other keys. Callers today always send full bounds.
test('ConfigStore: setOverlay with partial bounds keeps the other bound keys', () => {
  freshDirs();
  const s = store();
  const w = s.overlay('relative').bounds.width;
  s.setOverlay('relative', { bounds: { x: 11 } });
  assert.equal(s.overlay('relative').bounds.width, w);
});

test('ConfigStore: setOverlay applies options and full bounds, setGlobal applies options and hotkeys', () => {
  freshDirs();
  const s = store();
  const b = s.overlay('relative').bounds;
  s.setOverlay('relative', { ahead: 7, bounds: { ...b, x: 11 } });
  assert.equal(s.overlay('relative').ahead, 7);
  assert.equal(s.overlay('relative').bounds.x, 11);
  assert.equal(s.overlay('relative').bounds.width, b.width);
  s.setGlobal({ units: 'imperial', hotkeys: { ...s.data.global.hotkeys, toggleEdit: 'F8' } });
  assert.equal(s.data.global.units, 'imperial');
  assert.equal(s.data.global.hotkeys.toggleEdit, 'F8');
  assert.equal(s.data.global.hotkeys.openSettings, 'CommandOrControl+Shift+S');
});

// BUG (src/main/config.js setGlobal): same pattern as setOverlay: Object.assign swaps in patch.hotkeys before
// the merge, so a partial hotkeys patch drops the other hotkeys. The settings UI always sends the full set.
test('ConfigStore: setGlobal with a partial hotkeys patch keeps the other hotkeys', () => {
  freshDirs();
  const s = store();
  s.setGlobal({ hotkeys: { toggleEdit: 'F8' } });
  assert.equal(s.data.global.hotkeys.openSettings, 'CommandOrControl+Shift+S');
});

test('ConfigStore: resetOverlay restores defaults but keeps position and on/off', () => {
  freshDirs();
  const s = store();
  s.setOverlay('relative', { ahead: 9, enabled: false, bounds: { x: 42, y: 43 } });
  s.resetOverlay('relative');
  const r = s.overlay('relative');
  assert.equal(r.ahead, 4);
  assert.equal(r.enabled, false);
  assert.equal(r.bounds.x, 42);
  assert.equal(r.bounds.y, 43);
});

test('ConfigStore: profiles create / copy / rename / select / delete', () => {
  freshDirs();
  const s = store();
  s.setOverlay('relative', { ahead: 2 });
  const a = s.createProfile('Oval');
  assert.equal(s.data.activeProfile, a);
  assert.equal(s.profile.name, 'Oval');
  assert.equal(s.overlay('relative').ahead, 4, 'new profile starts from defaults');
  s.setActiveProfile('default');
  const b = s.createProfile('Copy', 'default');
  assert.notEqual(a, b);
  assert.equal(s.overlay('relative').ahead, 2, 'copied settings');
  s.setOverlay('relative', { ahead: 3 });
  assert.equal(s.data.profiles.default.overlays.relative.ahead, 2, 'copy is independent');
  s.renameProfile(b, 'Road');
  assert.equal(s.data.profiles[b].name, 'Road');
  s.renameProfile('nope', 'x'); // unknown key: no crash
  s.setActiveProfile('nope');
  assert.equal(s.data.activeProfile, b, 'unknown profile not selected');
  s.deleteProfile(b);
  assert.equal(s.data.profiles[b], undefined);
  assert.ok(s.data.profiles[s.data.activeProfile], 'active moved to a remaining profile');
  s.deleteProfile(a);
  s.deleteProfile('default');
  assert.equal(Object.keys(s.data.profiles).length, 1, 'the last profile can never be deleted');
});

test('ConfigStore: export / import a profile', () => {
  freshDirs();
  const s = store();
  s.setOverlay('relative', { ahead: 1 });
  const json = s.exportProfile();
  const obj = JSON.parse(json);
  assert.equal(obj.type, 'slipstream-profile');
  assert.equal(obj.profile.overlays.relative.ahead, 1);
  const key = s.importProfile(json);
  assert.equal(s.data.activeProfile, key);
  assert.equal(s.overlay('relative').ahead, 1);
  // legacy type accepted, partial profile migrated
  const k2 = s.importProfile(JSON.stringify({ type: 'iracing-overlay-profile', profile: { name: 'Old', overlays: {} } }));
  assert.ok(s.data.profiles[k2].overlays.standings);
  assert.throws(() => s.importProfile(JSON.stringify({ type: 'other', profile: {} })), /Not an overlay profile/);
  assert.throws(() => s.importProfile('nope'));
});

test('ConfigStore: export / import all settings, with a backup before import', () => {
  freshDirs();
  const s = store();
  s.setGlobal({ theme: 'neon' });
  s.saveNow();
  const all = s.exportAll();
  s.setGlobal({ theme: 'glass' });
  s.importAll(all);
  assert.equal(s.data.global.theme, 'neon');
  assert.ok(s.listBackups().some((b) => b.name.endsWith('-before-import.json')));
  assert.throws(() => s.importAll(JSON.stringify({ type: 'slipstream-profile', config: {} })), /Not a Slipstream settings file/);
});

test('ConfigStore: backups are capped at 15 and can be restored', () => {
  freshDirs();
  writeCfg({ global: { theme: 'paddock' } });
  const bdir = path.join(paths.userData, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const old = Date.now() / 1000 - 10000;
  for (let i = 0; i < 20; i++) {
    const f = path.join(bdir, `overlay-config-old-${i}-startup.json`);
    fs.writeFileSync(f, JSON.stringify({ global: { theme: 'contrast' } }));
    fs.utimesSync(f, old + i, old + i);
  }
  const s = store(); // takes a startup backup and prunes
  clearTimeout(s.saveTimer);
  const list = s.listBackups();
  assert.equal(list.length, 15);
  assert.ok(list[0].name.endsWith('-startup.json') && !list[0].name.includes('-old-'), 'newest first');
  assert.ok(!list.some((b) => b.name === 'overlay-config-old-0-startup.json'), 'oldest pruned');
  s.restoreBackup('overlay-config-old-19-startup.json');
  assert.equal(s.data.global.theme, 'contrast');
  assert.ok(s.listBackups().some((b) => b.name.endsWith('-before-restore.json')));
  // path traversal is stripped to a file name inside the backup folder
  assert.throws(() => s.restoreBackup('../overlay-config.json'));
});

test('ConfigStore: imports settings from the app\'s previous name once', () => {
  freshDirs();
  const legacyDir = path.join(paths.appData, 'iRacing Overlays');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'overlay-config.json'), JSON.stringify({ global: { theme: 'neon' } }));
  const s = store();
  clearTimeout(s.saveTimer);
  assert.equal(s.data.global.theme, 'neon');
  // an existing Slipstream config wins over the legacy one
  s.setGlobal({ theme: 'glass' });
  const s2 = store();
  clearTimeout(s2.saveTimer);
  assert.equal(s2.data.global.theme, 'glass');
});

test('ConfigStore: setTrackMap stores learned maps', () => {
  freshDirs();
  const s = store();
  s.setTrackMap('163-GP', [[0, 0], [1, 1]]);
  assert.deepEqual(s.data.trackMaps['163-GP'], [[0, 0], [1, 1]]);
});

// ---------------- per-car profiles ----------------

test('per-car profiles: nothing switches until a car is linked', () => {
  freshDirs();
  const s = quiet(store);
  assert.equal(s.profileForCar('mx5 mx52016'), null);
});

test('per-car profiles: linked car gets its profile, others the fallback (first profile by default)', () => {
  freshDirs();
  const s = quiet(store);
  const gt3 = s.createProfile('GT3');
  const mx5 = s.createProfile('MX-5');
  s.linkCar({ id: 'mx5 mx52016', name: 'Global Mazda MX-5 Cup' }, mx5);
  assert.deepEqual(s.data.cars['mx5 mx52016'], { name: 'Global Mazda MX-5 Cup', profile: mx5 });
  assert.deepEqual(s.profileForCar('mx5 mx52016'), { key: mx5, linked: true });
  assert.deepEqual(s.profileForCar('porsche992rgt3'), { key: 'default', linked: false });
  s.setCarFallback(gt3);
  assert.deepEqual(s.profileForCar('porsche992rgt3'), { key: gt3, linked: false });
  s.setCarFallback('nope');
  assert.equal(s.data.carFallback, null);
  s.unlinkCar('mx5 mx52016');
  assert.equal(s.profileForCar('mx5 mx52016'), null, 'no links left: back to switching by hand');
});

test('per-car profiles: linking needs a car and an existing profile', () => {
  freshDirs();
  const s = quiet(store);
  s.linkCar(null, 'default');
  s.linkCar({ id: '' }, 'default');
  s.linkCar({ id: 'x' }, 'missing');
  assert.deepEqual(s.data.cars, {});
  s.linkCar({ id: 'x' }, 'default');
  assert.equal(s.data.cars.x.name, 'x', 'name falls back to the id');
});

test('per-car profiles: deleting a profile drops its links and the fallback', () => {
  freshDirs();
  const s = quiet(store);
  const p = s.createProfile('Oval');
  s.linkCar({ id: 'a', name: 'A' }, p);
  s.linkCar({ id: 'b', name: 'B' }, 'default');
  s.setCarFallback(p);
  s.deleteProfile(p);
  assert.deepEqual(Object.keys(s.data.cars), ['b']);
  assert.equal(s.data.carFallback, null);
});

test('per-car profiles: survive a reload; links to missing profiles are dropped by migrate', () => {
  const m = migrate({ profiles: { default: { name: 'Default', overlays: {} } }, cars: { a: { name: 'A', profile: 'default' }, b: { name: 'B', profile: 'gone' } }, carFallback: 'gone' });
  assert.deepEqual(Object.keys(m.cars), ['a']);
  assert.equal(m.carFallback, null);
  assert.deepEqual(migrate({}).cars, {});
});

test('automatic per-car profiles: the first change in a car on the default copies it into a linked profile', () => {
  freshDirs();
  const s = quiet(store);
  const car = { id: 'porsche992rgt3', name: 'Porsche 911 GT3 R (992)' };
  s.setOverlay('speed', { layout: 'classic' });
  const key = s.forkForCar(car);
  assert.ok(key);
  assert.equal(s.data.activeProfile, key);
  assert.equal(s.profile.name, 'Porsche 911 GT3 R (992)');
  assert.equal(s.overlay('speed').layout, 'classic', 'starts as a copy of the default');
  assert.deepEqual(s.data.cars[car.id], { name: car.name, profile: key });
  s.setOverlay('speed', { layout: 'strip' }); // the change lands in the car's profile
  assert.equal(s.data.profiles.default.overlays.speed.layout, 'classic', 'default untouched');
  assert.equal(s.forkForCar(car), null, 'only once per car');
});

test('automatic per-car profiles: not for a hand-picked profile, no car, or when turned off', () => {
  freshDirs();
  const s = quiet(store);
  assert.equal(s.forkForCar(null), null);
  assert.equal(s.forkForCar({ id: '' }), null);
  s.createProfile('Rain'); // now active: picked by hand
  assert.equal(s.forkForCar({ id: 'a', name: 'A' }), null);
  s.setActiveProfile('default');
  s.setGlobal({ autoCarProfiles: false });
  assert.equal(s.forkForCar({ id: 'a', name: 'A' }), null);
  assert.deepEqual(s.data.cars, {});
});

test('automatic per-car profiles: the fallback counts as the default; names stay unique', () => {
  freshDirs();
  const s = quiet(store);
  const gt3 = s.createProfile('GT3');
  s.setCarFallback(gt3);
  s.createProfile('Car');
  s.setActiveProfile(gt3);
  const key = s.forkForCar({ id: 'c1', name: 'Car' });
  assert.equal(s.data.profiles[key].name, 'Car 2');
});

test('migrate: the Dashboard bottom row is hidden once where it was still all on, kept where set up', () => {
  const dash = (o) => migrate({ profiles: { default: { name: 'D', overlays: { dash: o } } } }).profiles.default.overlays.dash;
  const old = dash({ showLapInfo: true, showFuel: true, showBias: true, showWarnings: true });
  assert.deepEqual([old.showLapInfo, old.showFuel, old.showBias, old.showWarnings], [false, false, false, false]);
  assert.equal(old.footerV2, true);
  assert.equal(old.fitHeight, true, 'box shrinks to what is left');
  const mine = dash({ showLapInfo: false, showFuel: true, showBias: false, showWarnings: true });
  assert.deepEqual([mine.showFuel, mine.showWarnings], [true, true]);
  const again = dash({ footerV2: true, showLapInfo: true, showFuel: true, showBias: true, showWarnings: true });
  assert.equal(again.showLapInfo, true, 'only once: turning it all back on sticks');
  assert.equal(dash({}).showRpm, false);
});
