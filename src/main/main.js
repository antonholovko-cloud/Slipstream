const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const Registry = require('../shared/registry');
const { ConfigStore } = require('./config');
const { IRacingReader } = require('./irsdk');
const { MockSource } = require('./mock');
const { RaceModel } = require('./model');
const { Updater } = require('./updater');

// Dev helper: IRO_USERDATA isolates config (must run before the single-instance lock, which is per user-data dir).
if (process.env.IRO_USERDATA) app.setPath('userData', process.env.IRO_USERDATA);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// Transparent always-on-top windows work best without GPU compositing quirks on some drivers.
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Memory tuning. Measured with scripts/perf.ps1 on a 7-overlay layout:
//   pps     all overlay windows share one renderer process: ~436 MB -> ~218 MB,
//           same CPU, same 60 fps / frame gaps / update rate (scripts/smooth test)
//   nospare no spare renderer kept warm for new tabs (Slipstream never opens any)
// IRO_TUNE overrides the list for experiments ('' = none; also 'heap', 'nogpu').
const TUNE = new Set((process.env.IRO_TUNE !== undefined ? process.env.IRO_TUNE : 'nospare,pps').split(',').filter(Boolean));
const disabledFeatures = [];
if (TUNE.has('nospare')) disabledFeatures.push('SpareRendererForSitePerProcess');
// test runs render off-screen: keep Chromium from treating those windows as hidden
if (process.env.IRO_OFFSCREEN || process.env.IRO_SCREENSHOT) disabledFeatures.push('CalculateNativeWinOcclusion');
if (disabledFeatures.length) app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
if (TUNE.has('pps')) app.commandLine.appendSwitch('process-per-site');
if (TUNE.has('heap')) app.commandLine.appendSwitch('js-flags', '--max-semi-space-size=1 --max-old-space-size=96');
if (TUNE.has('nogpu')) app.disableHardwareAcceleration();

let config;
let tray = null;
let settingsWin = null;
const overlayWins = new Map(); // id -> { win, lastSent, visible }
let editMode = false;
let hiddenByUser = false;
let latestState = null;
let source = 'none'; // iracing | demo | none
let reader = null;
let mock = null;
let model = null;
let modelSource = null;
let loopTimer = null;
let updater = null;
let updateNotified = '';
let hotkeyErrors = [];
let quitting = false;
const forceDemo = process.argv.includes('--demo'); // runtime only, never saved
// Dev/test runs (screenshots) render far off-screen: nothing pops up on the user's
// desktop, and no tray icon or global hotkeys that would clash with a real instance.
const OFFSCREEN = !!(process.env.IRO_SCREENSHOT || process.env.IRO_OFFSCREEN);
const place = (b) => (OFFSCREEN ? { ...b, x: b.x - 30000, y: b.y - 30000 } : b);

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload.js');

function theme() {
  const g = config.data.global;
  const base = Registry.THEMES[g.theme] || Registry.THEMES.carbon;
  const t = Object.assign({}, base, g.themeOverrides || {});
  if (g.font) t.font = g.font;
  return t;
}

function overlayPayload(id) {
  return { id, settings: config.overlay(id), theme: theme(), global: config.data.global, editMode };
}

// ---------------- Overlay windows ----------------

function createOverlay(id) {
  const s = config.overlay(id);
  const b = OFFSCREEN ? place(s.bounds) : clampToDisplays(s.bounds);
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: editMode,
    show: false, backgroundColor: '#00000000', title: 'Overlay - ' + id,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, additionalArguments: ['--overlay-id=' + id] },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(!editMode);
  win.loadFile(path.join(RENDERER, 'overlay.html'), { query: { id } });
  win.on('closed', () => overlayWins.delete(id));
  overlayWins.set(id, { win, lastSent: 0, visible: false, ready: false });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.error(`[${id}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on('did-finish-load', () => {
    const o = overlayWins.get(id);
    if (o) o.ready = true;
  });
  // Overlays share one renderer process; if it ever dies, bring every overlay back.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[${id}] renderer gone (${details.reason}), reloading`);
    const o = overlayWins.get(id);
    if (o) o.ready = false;
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 500);
  });
}

function clampToDisplays(b) {
  const displays = screen.getAllDisplays();
  const onScreen = displays.some((d) => {
    const a = d.workArea;
    return b.x + 40 > a.x && b.x < a.x + a.width - 40 && b.y + 20 > a.y && b.y < a.y + a.height - 20;
  });
  if (onScreen) return b;
  const a = screen.getPrimaryDisplay().workArea;
  return Object.assign({}, b, { x: a.x + 40, y: a.y + 40 });
}

function syncOverlayWindows() {
  for (const def of Registry.OVERLAYS) {
    const s = config.overlay(def.id);
    const o = overlayWins.get(def.id);
    if (s.enabled && !o) createOverlay(def.id);
    if (!s.enabled && o) { o.win.destroy(); overlayWins.delete(def.id); }
  }
  for (const [id, o] of overlayWins) {
    const b = place(config.overlay(id).bounds);
    const cur = o.win.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) o.win.setBounds(b);
    if (o.ready) o.win.webContents.send('overlay:config', overlayPayload(id));
  }
}

function broadcastConfig() {
  syncOverlayWindows();
  sendSettings('settings:config', settingsPayload());
}

function setEditMode(on) {
  editMode = !!on;
  for (const [id, o] of overlayWins) {
    o.win.setIgnoreMouseEvents(!editMode);
    o.win.setFocusable(editMode);
    if (o.ready) o.win.webContents.send('overlay:config', overlayPayload(id));
  }
  updateTray();
  sendSettings('settings:status', statusPayload());
}

function sessionAllowed(s, st) {
  if (!st || !st.session) return true;
  const k = st.session.kind;
  if (k === 'race' && !s.showInRace) return false;
  if (k === 'qualify' && !s.showInQualify) return false;
  if (k === 'practice' && !s.showInPractice) return false;
  if (s.onlyOnTrack && !(st.player && st.player.onTrack)) return false;
  return true;
}

// Auto-hide while not driving (garage, setup, menus) or while stopped in the pits.
// Stopping has a short delay so a slow pit-lane crawl doesn't flicker; driving off shows at once.
// Returns { notDriving, inPits }; each overlay decides what to do in the pits (overlayAutoHidden).
let stoppedSince = null;
function autoHidden(st) {
  const none = { notDriving: false, inPits: false };
  if (source !== 'iracing' || !st || !st.player) return none;
  const g = config.data.global, p = st.player;
  // out of the car iRacing reports a replay (spectator view), so replays hide too unless enabled
  if (st.session && st.session.replay && g.showInReplays) return none;
  const notDriving = g.hideWhenNotDriving && (!p.onTrack || p.inGarage);
  const stopped = p.inPitStall || (p.onPitRoad && p.speed < 1);
  let inPits = false;
  if (stopped && p.speed < 2) {
    if (stoppedSince === null) stoppedSince = Date.now();
    inPits = Date.now() - stoppedSince > 800;
  } else stoppedSince = null;
  return { notDriving, inPits };
}

// Per overlay "In the pits": follow the General setting, keep showing, or hide.
function overlayAutoHidden(s, auto) {
  if (auto.notDriving) return true;
  if (!auto.inPits) return false;
  const rule = s.inPits || 'global';
  return rule === 'hide' || (rule === 'global' && config.data.global.hideWhenStoppedInPits);
}

function pickState(st, needs) {
  const out = { connected: st.connected, source };
  for (const k of needs) out[k] = st[k];
  return out;
}

// ---------------- Telemetry loop ----------------

function dataSource() { return forceDemo ? 'demo' : config.data.global.dataSource; }

function wantDemo() {
  const ds = dataSource();
  if (ds === 'demo') return true;
  if (ds === 'iracing') return false;
  return editMode || !!settingsWin; // auto: preview with demo data while configuring
}

function tick() {
  let frame = null;
  const ds = dataSource();
  if (ds !== 'demo') {
    try {
      if (!reader) reader = new IRacingReader();
      frame = reader.read();
      if (frame) setSource('iracing');
      else if (!reader.connected && source === 'iracing') setSource('none');
    } catch (e) {
      console.error('iRacing read error:', e.message);
      reader = null;
    }
  }
  if (source !== 'iracing' && !frame) {
    if (wantDemo()) {
      if (!mock) {
        // Start the demo a few laps into the race so fuel, gaps and history are populated.
        mock = new MockSource();
        model = new RaceModel({ trackMaps: {} });
        modelSource = 'demo';
        const skip = process.env.IRO_DEMO_SKIP !== undefined ? +process.env.IRO_DEMO_SKIP : 260;
        mock.fastForward(skip, (f) => model.update(f, config.data.global));
      }
      frame = mock.read();
      setSource('demo');
    } else {
      setSource('none');
      mock = null;
    }
  }
  if (frame) {
    if (!model || modelSource !== source) {
      model = source === 'demo'
        ? new RaceModel({ trackMaps: {} })
        : new RaceModel({ trackMaps: config.data.trackMaps, onTrackLearned: (id, pts) => config.setTrackMap(id, pts) });
      modelSource = source;
    }
    try {
      const st = model.update(frame, config.data.global);
      if (st) latestState = st;
      if (st && process.env.IRO_RELLOG && source === 'iracing') logRelative(frame.vars, st);
    } catch (e) {
      console.error('Model error:', e.stack);
    }
  }
  pushToOverlays();
}

// Diagnostics (IRO_RELLOG=1): what the relative is built from, twice a second, to
// <userData>/relative-log.jsonl, keyed by session time remaining (shown in the Relative footer)
// so photos of the sim's own relative can be matched to it.
let relLogAt = -1, relLogSiu = -1;
function logRelative(v, st) {
  if (Math.abs(v.SessionTime - relLogAt) < 0.5) return;
  relLogAt = v.SessionTime;
  const file = path.join(app.getPath('userData'), 'relative-log.jsonl');
  if (model.siu !== relLogSiu) {
    // once per session info update: every class's fields, to compare with the sim's own relative
    relLogSiu = model.siu;
    const di = (model.info || {}).DriverInfo || {};
    const classes = {};
    for (const d of di.Drivers || []) {
      if (d.CarIsPaceCar || d.IsSpectator) continue;
      const k = d.CarClassShortName || d.CarScreenNameShort;
      if (!classes[k]) classes[k] = { id: d.CarClassID, relSpeed: d.CarClassRelSpeed, est: d.CarClassEstLapTime, car: d.CarScreenNameShort, carId: d.CarID };
    }
    const wk = (model.info || {}).WeekendInfo || {};
    const info = { info: true, t: +v.SessionTime.toFixed(2), track: wk.TrackDisplayName, trackTemp: wk.TrackSurfaceTemp, driverCarEst: di.DriverCarEstLapTime, driverCarIdx: di.DriverCarIdx, classes };
    fs.appendFile(file, JSON.stringify(info) + String.fromCharCode(10), () => {});
  }
  const me = st.cars.find((c) => c.isPlayer);
  if (!me) return;
  const car = (c) => ({ n: c.number, cls: c.className, pct: +c.pct.toFixed(5), est: +c.estTime.toFixed(3), classEst: model.classEst(c), best: c.bestLap, last: c.lastLap, pit: c.onPitRoad, surf: c.surface });
  const byIdx = new Map(st.cars.map((c) => [c.idx, c]));
  const line = {
    t: +v.SessionTime.toFixed(2), remain: Math.round(v.SessionTimeRemain), driverEst: model.car.estLap,
    me: car(me), cars: st.relative.map((r) => ({ ...car(byIdx.get(r.idx)), gap: +r.gap.toFixed(3), pace: r.pace === null ? null : +r.pace.toFixed(3) })),
  };
  fs.appendFile(path.join(app.getPath('userData'), 'relative-log.jsonl'), JSON.stringify(line) + '\n', () => {});
}

function setSource(s) {
  if (s === source) return;
  source = s;
  if (s === 'none') latestState = null;
  sendSettings('settings:status', statusPayload());
  updateTray();
}

function pushToOverlays() {
  const now = Date.now();
  const auto = editMode ? { notDriving: false, inPits: false } : autoHidden(latestState);
  for (const [id, o] of overlayWins) {
    if (!o.ready) continue;
    const s = config.overlay(id);
    const def = Registry.byId(id);
    const shouldShow = !hiddenByUser && (editMode || (source !== 'none' && !overlayAutoHidden(s, auto) && sessionAllowed(s, latestState)));
    if (shouldShow !== o.visible) {
      o.visible = shouldShow;
      if (shouldShow) o.win.showInactive(); else o.win.hide();
    }
    if (!shouldShow || !latestState) continue;
    const interval = 1000 / Math.max(1, s.fps || 30);
    if (now - o.lastSent < interval - 2) continue;
    o.lastSent = now;
    if (!o.win.isDestroyed()) o.win.webContents.send('overlay:state', pickState(latestState, def.needs));
  }
}

// ---------------- Settings window ----------------

function settingsPayload() {
  return { config: config.data, theme: theme(), hotkeyErrors, userData: config.dir, file: config.file, lastSaved: config.lastSaved, backups: config.listBackups().slice(0, 10), version: app.getVersion() };
}

function statusPayload() {
  return { source, editMode, hidden: hiddenByUser, track: latestState && latestState.session ? latestState.session.track.name : '', session: latestState && latestState.session ? latestState.session.type : '' };
}

function sendSettings(ch, data) {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(ch, data);
}

// Windows won't let a new window take the foreground from a focused (maximized) game, so
// the settings window used to open hidden behind iRacing. Pin it on top briefly and focus it.
function bringToFront(win) {
  if (!win || win.isDestroyed() || OFFSCREEN) return;
  if (win.isMinimized()) win.restore();
  const b = win.getBounds();
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + 100 > a.x && b.x < a.x + a.width - 100 && b.y + 50 > a.y && b.y < a.y + a.height - 50;
  });
  if (!visible) win.center();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.moveTop();
  win.focus();
  setTimeout(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(false); }, 1500);
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    bringToFront(settingsWin);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1180, height: 800, minWidth: 900, minHeight: 600, title: 'Slipstream',
    ...(OFFSCREEN ? { x: -30000, y: -30000, skipTaskbar: true } : {}),
    backgroundColor: '#0b0f14', autoHideMenuBar: true, icon: makeIcon(64),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, offscreen: OFFSCREEN },
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'), { query: { page: process.env.IRO_PAGE || 'home' } });
  settingsWin.on('closed', () => { settingsWin = null; trayHint(); });
  settingsWin.once('ready-to-show', () => bringToFront(settingsWin));
}

// Closing the window doesn't quit (the overlays keep running), so tell people where it went.
// Shown the first few times only.
function trayHint() {
  if (!tray || OFFSCREEN || quitting) return;
  const n = config.data.global.trayHintsShown || 0;
  if (n >= 3) return;
  config.setGlobal({ trayHintsShown: n + 1 });
  try {
    tray.displayBalloon({
      iconType: 'info',
      title: 'Slipstream is still running',
      content: 'Your overlays stay on. Find Slipstream in the system tray (click ^ next to the clock) to open settings or quit.',
    });
  } catch (_) { /* balloons unsupported */ }
}

// ---------------- Hotkeys ----------------

// km/h <-> mph for every overlay at once (tray menu and hotkey)
function currentSpeedUnit() {
  const g = config.data.global;
  if (g.speedUnit === 'kmh' || g.speedUnit === 'mph') return g.speedUnit;
  const u = latestState && latestState.session ? latestState.session.units : g.units;
  return u === 'imperial' ? 'mph' : 'kmh';
}
function toggleSpeedUnit() {
  config.setGlobal({ speedUnit: currentSpeedUnit() === 'mph' ? 'kmh' : 'mph' });
  broadcastConfig();
  updateTray();
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyErrors = [];
  const hk = config.data.global.hotkeys;
  const actions = {
    toggleEdit: () => setEditMode(!editMode),
    toggleVisible: () => { hiddenByUser = !hiddenByUser; updateTray(); sendSettings('settings:status', statusPayload()); },
    openSettings: () => openSettings(),
    toggleSpeedUnit: () => toggleSpeedUnit(),
    nextProfile: () => {
      const keys = Object.keys(config.data.profiles);
      const i = keys.indexOf(config.data.activeProfile);
      config.setActiveProfile(keys[(i + 1) % keys.length]);
      broadcastConfig();
      updateTray();
    },
  };
  for (const [name, fn] of Object.entries(actions)) {
    const acc = hk[name];
    if (!acc) continue;
    try {
      if (!globalShortcut.register(acc, fn)) hotkeyErrors.push(`${acc} is already in use`);
    } catch (e) {
      hotkeyErrors.push(`${acc}: ${e.message}`);
    }
  }
}

// ---------------- Tray ----------------

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');

function makeIcon(size) {
  const img = nativeImage.createFromPath(ICON_PATH);
  return img.isEmpty() ? img : img.resize({ width: size, height: size, quality: 'best' });
}

function updateTray() {
  if (!tray) return;
  const profiles = Object.entries(config.data.profiles).map(([key, p]) => ({
    label: p.name, type: 'radio', checked: key === config.data.activeProfile,
    click: () => { config.setActiveProfile(key); broadcastConfig(); updateTray(); },
  }));
  const menu = Menu.buildFromTemplate([
    { label: `Slipstream v${app.getVersion()}`, enabled: false },
    { label: `Source: ${source === 'iracing' ? 'iRacing (live)' : source === 'demo' ? 'Demo data' : 'Waiting for iRacing…'}`, enabled: false },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    { label: 'Edit layout', type: 'checkbox', checked: editMode, click: () => setEditMode(!editMode), accelerator: config.data.global.hotkeys.toggleEdit },
    { label: 'Hide overlays', type: 'checkbox', checked: hiddenByUser, click: () => { hiddenByUser = !hiddenByUser; updateTray(); } },
    { label: 'Speed unit', submenu: [
      { label: 'km/h', type: 'radio', checked: currentSpeedUnit() === 'kmh', click: () => { config.setGlobal({ speedUnit: 'kmh' }); broadcastConfig(); updateTray(); } },
      { label: 'mph', type: 'radio', checked: currentSpeedUnit() === 'mph', click: () => { config.setGlobal({ speedUnit: 'mph' }); broadcastConfig(); updateTray(); } },
      { label: 'Follow iRacing', type: 'radio', checked: !['kmh', 'mph'].includes(config.data.global.speedUnit), click: () => { config.setGlobal({ speedUnit: 'auto' }); broadcastConfig(); updateTray(); } },
    ] },
    { label: 'Profile', submenu: profiles },
    ...updateMenu(),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Slipstream v${app.getVersion()} — ` + (source === 'iracing' ? 'connected' : source));
}

function updateMenu() {
  const u = updater && updater.state;
  if (!u) return [];
  if (u.status === 'ready') return [{ type: 'separator' }, { label: `Restart to update to ${u.version}`, click: () => updater.install() }];
  if (u.status === 'available') return [{ type: 'separator' }, { label: `Download Slipstream ${u.version}…`, click: () => updater.install() }];
  return [{ type: 'separator' }, { label: 'Check for updates', click: () => { updater.check(); openSettings(); } }];
}

function onUpdateState(u) {
  sendSettings('settings:update', u);
  updateTray();
  // one Windows notification per new version
  if (tray && (u.status === 'ready' || u.status === 'available') && updateNotified !== u.version) {
    updateNotified = u.version;
    tray.displayBalloon({
      iconType: 'info', title: 'Slipstream update',
      content: u.status === 'ready' ? `Version ${u.version} is ready. It installs when you quit Slipstream.` : `Version ${u.version} is available. Click to download.`,
    });
  }
}

// ---------------- IPC ----------------

function registerIpc() {
  ipcMain.handle('overlay:init', (e, id) => overlayPayload(id));

  ipcMain.handle('overlay:getBounds', (e) => BrowserWindow.fromWebContents(e.sender).getBounds());

  ipcMain.on('overlay:setBounds', (e, id, b, done, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const grid = opts && opts.exact ? 0 : config.data.global.snapToGrid || 0; // fit-to-content sizes are exact
    const snap = (v) => (grid > 1 ? Math.round(v / grid) * grid : Math.round(v));
    let nb = { x: snap(b.x), y: snap(b.y), width: Math.max(60, snap(b.width)), height: Math.max(30, snap(b.height)) };
    if (OFFSCREEN) { // test runs: keep the configured position, only sizes change
      const cur = config.overlay(id).bounds;
      nb = { ...nb, x: cur.x, y: cur.y };
    }
    win.setBounds(place(nb));
    if (done) {
      config.setOverlay(id, { bounds: nb });
      sendSettings('settings:config', settingsPayload());
    }
  });

  ipcMain.handle('settings:get', () => ({ ...settingsPayload(), status: statusPayload(), update: updater ? updater.state : null }));
  ipcMain.handle('settings:update', (e, op) => {
    if (!updater) return null;
    if (op === 'check') updater.check();
    else if (op === 'install') updater.install();
    else if (op === 'notes') updater.openNotes();
    return updater.state;
  });

  ipcMain.handle('settings:setOverlay', (e, id, patch) => { config.setOverlay(id, patch); broadcastConfig(); });
  ipcMain.handle('settings:resetOverlay', (e, id) => { config.resetOverlay(id); broadcastConfig(); });
  ipcMain.handle('settings:setGlobal', (e, patch) => {
    config.setGlobal(patch);
    if (patch.hotkeys) registerHotkeys();
    if (patch.dataSource) { model = null; mock = null; }
    if ('autoUpdate' in patch && updater) updater.setEnabled(patch.autoUpdate === true);
    broadcastConfig();
    updateTray();
  });
  ipcMain.handle('settings:setEditMode', (e, on) => setEditMode(on));
  ipcMain.handle('settings:setHidden', (e, on) => { hiddenByUser = !!on; updateTray(); sendSettings('settings:status', statusPayload()); });

  ipcMain.handle('settings:profile', async (e, op, a, b) => {
    switch (op) {
      case 'select': config.setActiveProfile(a); break;
      case 'create': config.createProfile(a, b); break;
      case 'delete': config.deleteProfile(a); break;
      case 'rename': config.renameProfile(a, b); break;
      case 'export': {
        const r = await dialog.showSaveDialog(settingsWin, { title: 'Export profile', defaultPath: `${config.profile.name}.overlay.json`, filters: [{ name: 'Overlay profile', extensions: ['json'] }] });
        if (!r.canceled) fs.writeFileSync(r.filePath, config.exportProfile(a));
        return !r.canceled;
      }
      case 'import': {
        const r = await dialog.showOpenDialog(settingsWin, { title: 'Import profile', filters: [{ name: 'Overlay profile', extensions: ['json'] }], properties: ['openFile'] });
        if (r.canceled) return false;
        config.importProfile(fs.readFileSync(r.filePaths[0], 'utf8'));
        break;
      }
      case 'snapshot': { // save the current layout under a new name, stay on the current profile
        const cur = config.data.activeProfile;
        config.createProfile(a, cur);
        config.setActiveProfile(cur);
        break;
      }
      case 'exportAll': {
        const r = await dialog.showSaveDialog(settingsWin, { title: 'Export all settings', defaultPath: 'slipstream-settings.json', filters: [{ name: 'Slipstream settings', extensions: ['json'] }] });
        if (!r.canceled) fs.writeFileSync(r.filePath, config.exportAll());
        return !r.canceled;
      }
      case 'importAll': {
        const r = await dialog.showOpenDialog(settingsWin, { title: 'Import all settings', filters: [{ name: 'Slipstream settings', extensions: ['json'] }], properties: ['openFile'] });
        if (r.canceled) return false;
        config.importAll(fs.readFileSync(r.filePaths[0], 'utf8'));
        registerHotkeys();
        break;
      }
      case 'restore':
        config.restoreBackup(a);
        registerHotkeys();
        break;
      default: break;
    }
    broadcastConfig();
    updateTray();
    return true;
  });

  ipcMain.handle('settings:forgetTrack', (e, id) => {
    if (id === '*') config.data.trackMaps = {}; else delete config.data.trackMaps[id];
    config.save();
    model = null;
    return true;
  });

  // league class splits: who lands in which sub-class with the given rules (preview on the Classes page)
  ipcMain.handle('settings:classes', (e, rules) => (model && model.info ? model.classPreview(rules) : null));
  ipcMain.handle('settings:displays', () => screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id })));
}

// ---------------- App lifecycle ----------------

// Dev helper: IRO_SCREENSHOT=<dir> captures every window then quits.

async function captureAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wins = [['settings', settingsWin], ...[...overlayWins].map(([id, o]) => [id, o.win])];
  for (const [name, w] of wins) {
    if (!w || w.isDestroyed()) continue;
    try {
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
    } catch (e) { console.error('capture failed', name, e.message); }
  }
  app.quit();
}

app.whenReady().then(() => {
  config = new ConfigStore();
  config.onSaved = () => sendSettings('settings:saved', { lastSaved: config.lastSaved });
  registerIpc();
  if (!OFFSCREEN) {
    registerHotkeys();
    tray = new Tray(makeIcon(32));
    tray.on('click', openSettings);
  }
  updater = new Updater({ onChange: onUpdateState });
  // Dev helper: IRO_UPDATE_CHECK=1 checks right away and prints each update state.
  if (process.env.IRO_UPDATE_CHECK) {
    const log = (u) => console.log('update:', JSON.stringify(u));
    updater.onChange = (u) => { log(u); onUpdateState(u); };
    updater.check();
  }
  if (!OFFSCREEN) {
    updater.setEnabled(config.data.global.autoUpdate === true);
    tray.on('balloon-click', () => (updater.state.status === 'available' ? updater.install() : openSettings()));
  }
  updateTray();
  syncOverlayWindows();
  // Launching the app always shows the window; only an explicit --hidden start stays in the tray.
  if (!process.argv.includes('--hidden')) openSettings();
  loopTimer = setInterval(tick, 1000 / 60);
  screen.on('display-removed', () => syncOverlayWindows());
  if (process.env.IRO_EDIT) setTimeout(() => setEditMode(true), 1500);
  if (process.env.IRO_SCREENSHOT) setTimeout(() => captureAll(process.env.IRO_SCREENSHOT), +(process.env.IRO_SCREENSHOT_DELAY || 8000));
});

// Hook for dev scripts (scripts/screenshots.js) that drive the running app.
global.__slipstream = {
  overlayWins, openSettings, setEditMode,
  get settingsWin() { return settingsWin; },
  get config() { return config; },
  get mock() { return mock; },
};

app.on('second-instance', () => openSettings());
app.on('window-all-closed', (e) => { /* keep running in tray */ });
app.on('before-quit', () => { quitting = true; clearInterval(loopTimer); });
app.on('will-quit', () => {
  clearInterval(loopTimer);
  globalShortcut.unregisterAll();
  if (config) config.saveNow();
});
