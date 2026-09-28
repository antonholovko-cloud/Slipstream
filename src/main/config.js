const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const Registry = require('../shared/registry');

const CONFIG_VERSION = 1;

function defaultGlobal() {
  return {
    theme: 'carbon',
    themeOverrides: {},
    font: '',
    units: 'auto', // auto | metric | imperial
    dataSource: 'auto', // auto | iracing | demo
    hotkeys: {
      toggleEdit: 'CommandOrControl+Shift+E',
      toggleVisible: 'CommandOrControl+Shift+H',
      openSettings: 'CommandOrControl+Shift+S',
      nextProfile: 'CommandOrControl+Shift+P',
    },
    focusCamCar: true, // follow the camera car when spectating / replay
    startMinimized: false,
    snapToGrid: 10,
  };
}

function defaultProfile(name) {
  const overlays = {};
  for (const def of Registry.OVERLAYS) overlays[def.id] = Registry.defaultSettingsFor(def);
  return { name, overlays };
}

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    global: defaultGlobal(),
    activeProfile: 'default',
    profiles: { default: defaultProfile('Default') },
    trackMaps: {},
  };
}

// Fill in any fields missing from an older / partial config with defaults,
// so adding new overlays or options never breaks existing user configs.
function migrate(cfg) {
  const def = defaultConfig();
  const out = Object.assign({}, def, cfg);
  out.global = Object.assign({}, def.global, cfg.global || {});
  out.global.hotkeys = Object.assign({}, def.global.hotkeys, (cfg.global || {}).hotkeys || {});
  out.profiles = cfg.profiles && Object.keys(cfg.profiles).length ? cfg.profiles : def.profiles;
  for (const key of Object.keys(out.profiles)) {
    const p = out.profiles[key];
    p.overlays = p.overlays || {};
    mergeInputsIntoDash(p.overlays);
    for (const odef of Registry.OVERLAYS) {
      const base = Registry.defaultSettingsFor(odef);
      const cur = p.overlays[odef.id] || {};
      const merged = Object.assign({}, base, cur);
      merged.bounds = Object.assign({}, base.bounds, cur.bounds || {});
      // merge column lists: keep user order/toggles, append new columns
      for (const f of odef.schema.concat(Registry.COMMON_SCHEMA)) {
        if (f.type !== 'columns') continue;
        const userCols = Array.isArray(cur[f.key]) ? cur[f.key].filter((c) => f.columns.some((d) => d.id === c.id)) : [];
        for (const c of base[f.key]) if (!userCols.some((u) => u.id === c.id)) userCols.push(c);
        merged[f.key] = userCols;
      }
      p.overlays[odef.id] = merged;
    }
  }
  if (!out.profiles[out.activeProfile]) out.activeProfile = Object.keys(out.profiles)[0];
  out.trackMaps = cfg.trackMaps || {};
  out.version = CONFIG_VERSION;
  return out;
}

// v0.1.x had separate "inputs" and "dash" overlays; they are now one. Keep the
// dashboard's position, grow it to fit, and carry over the input options.
function mergeInputsIntoDash(overlays) {
  const inp = overlays.inputs;
  if (!inp) return;
  const dash = overlays.dash || {};
  const keys = ['traceSeconds', 'traceWidth', 'showBars', 'showClutch', 'showSteering', 'showSteerTrace', 'showTrace',
    'throttleColor', 'brakeColor', 'absColor', 'clutchColor', 'steerColor'];
  for (const k of keys) if (inp[k] !== undefined && dash[k] === undefined) dash[k] = inp[k];
  if (!inp.enabled) { dash.showTrace = false; dash.showBars = false; dash.showSteering = false; }
  if (inp.enabled && !dash.enabled && inp.bounds) dash.bounds = { ...inp.bounds };
  else if (inp.enabled && dash.enabled && inp.bounds && dash.bounds) {
    // both were shown: start at the top-left of the two, where the pair sat on screen
    dash.bounds = { ...dash.bounds, x: Math.min(dash.bounds.x, inp.bounds.x), y: Math.min(dash.bounds.y, inp.bounds.y) };
  }
  dash.enabled = !!(dash.enabled || inp.enabled);
  if (dash.bounds) dash.bounds = { ...dash.bounds, width: Math.max(dash.bounds.width || 0, 580), height: Math.max(dash.bounds.height || 0, 190) };
  dash.fps = Math.max(dash.fps || 30, inp.fps || 60);
  overlays.dash = dash;
  delete overlays.inputs;
}

const MAX_BACKUPS = 15;

class ConfigStore {
  constructor() {
    this.dir = app.getPath('userData');
    this.file = path.join(this.dir, 'overlay-config.json');
    this.backupDir = path.join(this.dir, 'backups');
    this.importLegacy();
    this.backup('startup');
    this.data = this.load();
    this.saveTimer = null;
    this.lastSaved = null;
    if (fs.existsSync(this.file)) this.save(); // persist any migration right away
  }

  // Keep a rolling set of copies of the config file (taken at startup and before imports/restores).
  backup(reason) {
    try {
      if (!fs.existsSync(this.file)) return null;
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const name = `overlay-config-${stamp}-${reason}.json`;
      fs.copyFileSync(this.file, path.join(this.backupDir, name));
      const all = this.listBackups();
      for (const old of all.slice(MAX_BACKUPS)) fs.unlinkSync(path.join(this.backupDir, old.name));
      return name;
    } catch (e) {
      console.error('Backup failed:', e.message);
      return null;
    }
  }

  listBackups() {
    try {
      return fs.readdirSync(this.backupDir)
        .filter((f) => f.endsWith('.json'))
        .map((name) => ({ name, time: fs.statSync(path.join(this.backupDir, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
    } catch (_) {
      return [];
    }
  }

  restoreBackup(name) {
    const src = path.join(this.backupDir, path.basename(name));
    const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
    this.saveNow();
    this.backup('before-restore');
    this.data = migrate(raw);
    this.saveNow();
  }

  exportAll() {
    return JSON.stringify({ type: 'slipstream-settings', version: CONFIG_VERSION, config: this.data }, null, 2);
  }

  importAll(json) {
    const obj = JSON.parse(json);
    if (!obj || obj.type !== 'slipstream-settings' || !obj.config) throw new Error('Not a Slipstream settings file');
    this.saveNow();
    this.backup('before-import');
    this.data = migrate(obj.config);
    this.saveNow();
  }

  // Carry settings over from the app's previous name ("iRacing Overlays").
  importLegacy() {
    const legacy = path.join(app.getPath('appData'), 'iRacing Overlays', 'overlay-config.json');
    try {
      if (!fs.existsSync(this.file) && fs.existsSync(legacy)) {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.copyFileSync(legacy, this.file);
      }
    } catch (e) {
      console.error('Legacy config import failed:', e.message);
    }
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return migrate(raw);
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Config load failed, using defaults:', e.message);
      return defaultConfig();
    }
  }

  // Debounced atomic save.
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
      this.lastSaved = Date.now();
      if (this.onSaved) this.onSaved();
    } catch (e) {
      console.error('Config save failed:', e.message);
    }
  }

  get profile() { return this.data.profiles[this.data.activeProfile]; }
  overlay(id) { return this.profile.overlays[id]; }

  setOverlay(id, patch) {
    const cur = this.profile.overlays[id];
    Object.assign(cur, patch);
    if (patch.bounds) cur.bounds = Object.assign({}, cur.bounds, patch.bounds);
    this.save();
    return cur;
  }

  setGlobal(patch) {
    Object.assign(this.data.global, patch);
    if (patch.hotkeys) this.data.global.hotkeys = Object.assign({}, this.data.global.hotkeys, patch.hotkeys);
    this.save();
  }

  resetOverlay(id) {
    const def = Registry.byId(id);
    const keepBounds = this.profile.overlays[id].bounds;
    const enabled = this.profile.overlays[id].enabled;
    this.profile.overlays[id] = Object.assign(Registry.defaultSettingsFor(def), { bounds: keepBounds, enabled });
    this.save();
  }

  createProfile(name, copyFrom) {
    const key = 'p' + Date.now().toString(36);
    const src = copyFrom && this.data.profiles[copyFrom];
    this.data.profiles[key] = src ? JSON.parse(JSON.stringify(src)) : defaultProfile(name);
    this.data.profiles[key].name = name;
    this.data.activeProfile = key;
    this.save();
    return key;
  }

  deleteProfile(key) {
    if (Object.keys(this.data.profiles).length <= 1) return;
    delete this.data.profiles[key];
    if (this.data.activeProfile === key) this.data.activeProfile = Object.keys(this.data.profiles)[0];
    this.save();
  }

  renameProfile(key, name) {
    if (this.data.profiles[key]) this.data.profiles[key].name = name;
    this.save();
  }

  setActiveProfile(key) {
    if (this.data.profiles[key]) this.data.activeProfile = key;
    this.save();
  }

  exportProfile(key) {
    return JSON.stringify({ type: 'slipstream-profile', version: CONFIG_VERSION, global: this.data.global, profile: this.data.profiles[key || this.data.activeProfile] }, null, 2);
  }

  importProfile(json) {
    const obj = JSON.parse(json);
    if (!obj || !['slipstream-profile', 'iracing-overlay-profile'].includes(obj.type) || !obj.profile) throw new Error('Not an overlay profile file');
    const key = 'p' + Date.now().toString(36);
    this.data.profiles[key] = obj.profile;
    this.data = migrate(this.data);
    this.data.activeProfile = key;
    this.save();
    return key;
  }

  setTrackMap(id, map) {
    this.data.trackMaps[id] = map;
    this.save();
  }
}

module.exports = { ConfigStore, migrate };
