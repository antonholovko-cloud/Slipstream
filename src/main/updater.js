/*
 * Update checks against GitHub Releases. Only runs when the player turned on
 * automatic checks, or pressed "Check now". The only request is for the release
 * info on GitHub; nothing about the player is sent.
 *
 * Installed app: electron-updater downloads the new installer in the background
 * and installs it when Slipstream quits (or right away with "Restart now").
 * Portable exe / dev runs: notify only, with a link to the download page.
 */

const { app, net, shell } = require('electron');

const { version: VERSION } = require('../../package.json');
const REPO = 'antonholovko-cloud/Slipstream';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const FIRST_CHECK_MS = 15 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

class Updater {
  constructor({ onChange }) {
    this.onChange = onChange || (() => {});
    this.kind = !app.isPackaged ? 'dev' : process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installer';
    this.state = { kind: this.kind, current: VERSION, status: 'idle', version: '', percent: 0, error: '', checkedAt: 0 };
    this.timer = null;
    this.auto = null;
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.onChange(this.state);
  }

  // Turn periodic checks on or off (follows the player's setting).
  setEnabled(on) {
    clearTimeout(this.timer);
    clearInterval(this.timer);
    this.timer = null;
    if (!on) return;
    this.timer = setTimeout(() => {
      this.check();
      this.timer = setInterval(() => this.check(), EVERY_MS);
    }, FIRST_CHECK_MS);
  }

  autoUpdater() {
    if (this.auto) return this.auto;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: '' }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'none', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (i) => this.set({ status: 'downloading', version: i.version, percent: 0, checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (i) => this.set({ status: 'ready', version: i.version, percent: 100 }));
    autoUpdater.on('error', (e) => this.set({ status: 'error', error: String((e && e.message) || e).split('\n')[0] }));
    this.auto = autoUpdater;
    return autoUpdater;
  }

  async check() {
    if (['checking', 'downloading', 'ready'].includes(this.state.status)) return;
    if (this.kind === 'installer') {
      try { await this.autoUpdater().checkForUpdates(); } catch (e) { this.set({ status: 'error', error: String(e.message || e).split('\n')[0] }); }
      return;
    }
    // portable / dev: look at the latest release and notify
    this.set({ status: 'checking', error: '' });
    try {
      const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Slipstream' },
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const rel = await res.json();
      const v = String(rel.tag_name || '').replace(/^v/, '');
      this.set(newer(v, this.state.current)
        ? { status: 'available', version: v, checkedAt: Date.now() }
        : { status: 'none', version: v, checkedAt: Date.now() });
    } catch (e) {
      this.set({ status: 'error', error: String(e.message || e) });
    }
  }

  openNotes() { shell.openExternal(RELEASES); }

  // "Restart now" for a downloaded update, or open the download page otherwise.
  install() {
    if (this.kind === 'installer' && this.state.status === 'ready') {
      setImmediate(() => this.autoUpdater().quitAndInstall(true, true));
      return;
    }
    shell.openExternal(RELEASES);
  }
}

module.exports = { Updater, newer };
