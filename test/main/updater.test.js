const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { EventEmitter } = require('events');

// Stub electron (app / net / shell) and electron-updater so nothing touches the network.
const electron = {
  app: { isPackaged: false },
  net: { fetch: async () => { throw new Error('fetch not stubbed'); } },
  shell: { opened: [], openExternal(url) { this.opened.push(url); } },
};
const autoUpdater = Object.assign(new EventEmitter(), {
  checks: 0, installs: [], result: null,
  async checkForUpdates() { this.checks++; if (this.result instanceof Error) throw this.result; return this.result; },
  quitAndInstall(...a) { this.installs.push(a); },
});
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return electron;
  if (req === 'electron-updater') return { autoUpdater };
  return realLoad.call(this, req, ...rest);
};
const { Updater, newer } = require('../../src/main/updater');
const { version: VERSION } = require('../../package.json');

const release = (tag, ok = true, status = 200) => async (url, opts) => {
  assert.match(url, /^https:\/\/api\.github\.com\/repos\/antonholovko-cloud\/Slipstream\/releases\/latest$/);
  assert.equal(opts.headers['User-Agent'], 'Slipstream');
  return { ok, status, json: async () => ({ tag_name: tag }) };
};
function make(kind) {
  electron.app.isPackaged = kind !== 'dev';
  if (kind === 'portable') process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\x'; else delete process.env.PORTABLE_EXECUTABLE_DIR;
  const changes = [];
  const u = new Updater({ onChange: (s) => changes.push({ ...s }) });
  return { u, changes };
}

// ---------------- newer() ----------------

test('newer compares major / minor / patch numerically', () => {
  assert.equal(newer('0.5.6', '0.5.5'), true);
  assert.equal(newer('0.6.0', '0.5.9'), true);
  assert.equal(newer('1.0.0', '0.99.99'), true);
  assert.equal(newer('0.5.10', '0.5.9'), true, 'numeric, not string compare');
  assert.equal(newer('0.5.5', '0.5.5'), false);
  assert.equal(newer('0.5.4', '0.5.5'), false);
  assert.equal(newer('0.4.99', '0.5.0'), false);
});

test('newer ignores a leading v and treats missing parts as 0', () => {
  assert.equal(newer('v0.5.6', '0.5.5'), true);
  assert.equal(newer('v1', '0.9.9'), true);
  assert.equal(newer('1.0', '1.0.0'), false);
  assert.equal(newer('1.0.1', 'v1'), true);
});

// ---------------- Updater ----------------

test('install kind: dev when unpackaged, portable with PORTABLE_EXECUTABLE_DIR, else installer', () => {
  assert.equal(make('dev').u.kind, 'dev');
  assert.equal(make('portable').u.kind, 'portable');
  assert.equal(make('installer').u.kind, 'installer');
  const { u } = make('dev');
  assert.deepEqual(u.state, { kind: 'dev', current: VERSION, status: 'idle', version: '', percent: 0, error: '', checkedAt: 0 });
});

test('portable / dev: a newer GitHub release is reported as available', async () => {
  const { u, changes } = make('portable');
  electron.net.fetch = release('v99.0.0');
  await u.check();
  assert.equal(changes[0].status, 'checking');
  assert.equal(u.state.status, 'available');
  assert.equal(u.state.version, '99.0.0');
  assert.ok(u.state.checkedAt > 0);
});

test('portable / dev: same or older release -> "none"', async () => {
  const { u } = make('dev');
  electron.net.fetch = release('v' + VERSION);
  await u.check();
  assert.equal(u.state.status, 'none');
  electron.net.fetch = release('v0.0.1');
  await u.check();
  assert.equal(u.state.status, 'none');
});

test('portable / dev: HTTP errors and network failures become an error state', async () => {
  const { u } = make('portable');
  electron.net.fetch = release('v99.0.0', false, 403);
  await u.check();
  assert.equal(u.state.status, 'error');
  assert.match(u.state.error, /403/);
  electron.net.fetch = async () => { throw new Error('offline'); };
  await u.check();
  assert.equal(u.state.status, 'error');
  assert.equal(u.state.error, 'offline');
});

test('check() does nothing while already checking, downloading or ready', async () => {
  const { u } = make('portable');
  let calls = 0;
  electron.net.fetch = async () => { calls++; return { ok: true, json: async () => ({ tag_name: 'v99.0.0' }) }; };
  for (const status of ['checking', 'downloading', 'ready']) {
    u.state.status = status;
    await u.check();
  }
  assert.equal(calls, 0);
});

test('installer: uses electron-updater and maps its events to states', async () => {
  const { u, changes } = make('installer');
  autoUpdater.removeAllListeners();
  u.auto = null;
  const before = autoUpdater.checks;
  await u.check();
  assert.equal(autoUpdater.checks, before + 1);
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  autoUpdater.emit('checking-for-update');
  assert.equal(u.state.status, 'checking');
  autoUpdater.emit('update-available', { version: '9.9.9' });
  assert.deepEqual([u.state.status, u.state.version, u.state.percent], ['downloading', '9.9.9', 0]);
  autoUpdater.emit('download-progress', { percent: 41.6 });
  assert.equal(u.state.percent, 42);
  autoUpdater.emit('update-downloaded', { version: '9.9.9' });
  assert.deepEqual([u.state.status, u.state.percent], ['ready', 100]);
  assert.ok(changes.length >= 4);
  // the updater is set up only once
  assert.equal(u.autoUpdater(), autoUpdater);
  assert.equal(autoUpdater.listenerCount('update-downloaded'), 1);
});

test('installer: "no update" and errors (first line only)', async () => {
  const { u } = make('installer');
  autoUpdater.removeAllListeners();
  u.autoUpdater();
  autoUpdater.emit('update-not-available');
  assert.equal(u.state.status, 'none');
  autoUpdater.emit('error', new Error('bad signature\nstack...'));
  assert.equal(u.state.status, 'error');
  assert.equal(u.state.error, 'bad signature');
  // checkForUpdates throwing is also caught
  const { u: u2 } = make('installer');
  autoUpdater.removeAllListeners();
  autoUpdater.result = new Error('no network\nmore');
  await u2.check();
  autoUpdater.result = null;
  assert.equal(u2.state.status, 'error');
  assert.equal(u2.state.error, 'no network');
});

test('install(): restart into a downloaded update, otherwise open the download page', async () => {
  const { u } = make('installer');
  autoUpdater.removeAllListeners();
  u.state.status = 'ready';
  const n = autoUpdater.installs.length;
  u.install();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(autoUpdater.installs[n], [true, true]);

  const { u: p } = make('portable');
  electron.shell.opened.length = 0;
  p.install();
  p.openNotes();
  assert.deepEqual(electron.shell.opened, ['https://github.com/antonholovko-cloud/Slipstream/releases/latest', 'https://github.com/antonholovko-cloud/Slipstream/releases/latest']);
});

test('setEnabled: first check after 15 s, then every 6 hours; off stops it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { u } = make('portable');
  let checks = 0;
  u.check = () => { checks++; };
  u.setEnabled(true);
  t.mock.timers.tick(14999);
  assert.equal(checks, 0);
  t.mock.timers.tick(1);
  assert.equal(checks, 1);
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  assert.equal(checks, 2);
  u.setEnabled(false);
  assert.equal(u.timer, null);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(checks, 2);
  u.setEnabled(true);
  u.setEnabled(true); // re-enabling doesn't double up
  t.mock.timers.tick(15000);
  assert.equal(checks, 3);
  u.setEnabled(false);
});
