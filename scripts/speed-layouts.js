/*
 * Renders the Speed overlay in each layout at a few set moments (mid revs, shift point,
 * wheelspin, lock-up) into docs/screenshots/speed-layouts.png for the README.
 * Usage: npm run screenshots:speed
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const Registry = require('../src/shared/registry');
const { demoRace, pickState } = require('../test/helpers/demo');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots', 'speed-layouts.png');
const SCALE = 2; // crisp on high-DPI screens; the README shows it at half size
app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE));

const MOMENTS = [
  ['Mid revs', { gear: 4, rpm: 7250, speed: 52 }],
  ['Shift now', { gear: 4, rpm: 8050, speed: 58 }],
  ['Wheelspin', { gear: 2, rpm: 6900, speed: 24, throttle: 1, slip: { learned: true, dev: 0.15, abs: false } }],
  ['Lock-up', { gear: 3, rpm: 5200, speed: 30, brake: 1, slip: { learned: true, dev: -0.25, abs: false } }],
];
const LAYOUTS = [['rails', 'Side lights'], ['strip', 'Light strip'], ['classic', 'Classic']];
const W = 270; // overlay width, px

const race = demoRace();
const def = Registry.byId('speed');
const payloads = new Map();
ipcMain.handle('overlay:init', (e) => payloads.get(e.sender.id));
ipcMain.handle('overlay:getBounds', (e) => BrowserWindow.fromWebContents(e.sender).getBounds());
ipcMain.on('overlay:setBounds', () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(layout, player) {
  const h = layout === 'strip' ? 84 : 70;
  const settings = Object.assign(Registry.defaultSettingsFor(def), { layout, bounds: { x: 0, y: 0, width: W, height: h } });
  const win = new BrowserWindow({
    x: -30000, y: -30000, width: W, height: h, show: true, skipTaskbar: true, transparent: true, frame: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(ROOT, 'src', 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  payloads.set(win.webContents.id, { id: 'speed', settings, theme: Registry.THEMES.carbon, global: race.global, editMode: false });
  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'overlay.html'), { query: { id: 'speed' } });
  await sleep(400);
  const st = structuredClone(race.state);
  Object.assign(st.player, { throttle: 0, brake: 0, slip: { learned: true, dev: 0, abs: false } }, player);
  for (let i = 0; i < 5; i++) { win.webContents.send('overlay:state', pickState(st, def.needs)); await sleep(60); }
  // stop the strobes on their lit phase so the picture shows them
  await win.webContents.executeJavaScript(`document.querySelectorAll('*').forEach((e) => { e.style.animation = 'none'; }); 1`);
  await sleep(100);
  const img = await win.webContents.capturePage();
  // keep the window open: overlays share a renderer process and destroying one aborts the next load
  return { url: img.toDataURL(), h };
}

app.whenReady().then(async () => {
  const rows = [];
  for (const [layout, name] of LAYOUTS) {
    const shots = [];
    for (const [, player] of MOMENTS) shots.push(await shoot(layout, player));
    rows.push({ name, shots });
  }
  const page = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await page.loadURL('data:text/html,<body></body>');
  const data = await page.webContents.executeJavaScript(`(async () => {
    const S = ${SCALE}, rows = ${JSON.stringify(rows)}, moments = ${JSON.stringify(MOMENTS.map((m) => m[0]))};
    const lw = 120, cw = ${W} + 24, rh = 108, top = 44;
    const c = document.createElement('canvas');
    c.width = (lw + cw * moments.length + 12) * S; c.height = (top + rh * rows.length + 8) * S;
    const g = c.getContext('2d'); g.scale(S, S);
    const bg = g.createLinearGradient(0, 0, c.width / S, c.height / S);
    bg.addColorStop(0, '#1b2438'); bg.addColorStop(1, '#3a2c36');
    g.fillStyle = bg; g.fillRect(0, 0, c.width / S, c.height / S);
    g.font = '600 15px "Segoe UI", sans-serif'; g.fillStyle = '#94a3b8';
    moments.forEach((m, i) => g.fillText(m, lw + i * cw + 12, 28));
    for (const [r, row] of rows.entries()) {
      g.fillStyle = '#e2e8f0'; g.font = '700 15px "Segoe UI", sans-serif';
      g.fillText(row.name, 16, top + r * rh + rh / 2 + 5);
      for (const [i, s] of row.shots.entries()) {
        const im = new Image(); im.src = s.url; await im.decode();
        g.drawImage(im, lw + i * cw + 12, top + r * rh + (rh - s.h) / 2, ${W}, s.h);
      }
    }
    return c.toDataURL('image/png');
  })()`);
  fs.writeFileSync(OUT, Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', OUT);
  app.quit();
});
