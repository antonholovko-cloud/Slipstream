/*
 * Renders a few Dashboard & Inputs configurations side by side from the demo race (played
 * in real time for a few seconds so the pedal trace has history) into
 * docs/screenshots/dash-layouts.png for the README.
 * Usage: npm run screenshots:dash
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const Registry = require('../src/shared/registry');
const { MockSource } = require('../src/main/mock');
const { RaceModel } = require('../src/main/model');
const { pickState, DEFAULT_GLOBAL } = require('../test/helpers/demo');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots', 'dash-layouts.png');
const SCALE = 2; // crisp on high-DPI screens; the README shows it at half size
app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE));

const W = 580;
const CONFIGS = [
  ['Default', 'shift lights, gear & speed, pedal trace and bars, wheel', {}],
  ['Everything on', 'plus RPM number, steering angle and the bottom row', { showRpm: true, showSteerAngle: true, showLapInfo: true, showFuel: true, showBias: true, showWarnings: true, wheelStyle: 'rs50' }],
  ['Inputs only', 'pedal trace and bars with a formula wheel', { shiftLights: false, slipLight: false, showGear: false, showRpmBar: false, wheelStyle: 'formula' }],
  ['No wheel', 'revs, speed and pedals, with steering in the trace', { showSteering: false, showSteerTrace: true }],
];
const PLAY_SECONDS = 9;

const def = Registry.byId('dash');
const payloads = new Map();
ipcMain.handle('overlay:init', (e) => payloads.get(e.sender.id));
ipcMain.handle('overlay:getBounds', (e) => BrowserWindow.fromWebContents(e.sender).getBounds());
// "shrink box height to fit" asks for its height: give it, so every config is as tall as its contents
ipcMain.on('overlay:setBounds', (e, id, b) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setSize(W, Math.round(b.height)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  // demo race at a moment with a braking zone (and a lock-up) followed by wheelspin on the exit
  const mock = new MockSource();
  const model = new RaceModel({ trackMaps: {} });
  const g = { ...DEFAULT_GLOBAL };
  let state = null;
  mock.fastForward(Number(process.env.IRO_DEMO_SKIP || 283), (f) => { const st = model.update(f, g); if (st) state = st; });

  const wins = [];
  for (const [, , patch] of CONFIGS) {
    const settings = Object.assign(Registry.defaultSettingsFor(def), { fitHeight: true }, patch, { bounds: { x: 0, y: 0, width: W, height: 100 } });
    const win = new BrowserWindow({
      x: -30000, y: -30000, width: W, height: 100, show: true, skipTaskbar: true, transparent: true, frame: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(ROOT, 'src', 'preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    payloads.set(win.webContents.id, { id: 'dash', settings, theme: Registry.THEMES.carbon, global: g, editMode: false });
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'overlay.html'), { query: { id: 'dash' } });
    wins.push(win); // kept open: overlays share a renderer process and destroying one aborts the next load
  }
  await sleep(300);
  for (let t = 0; t < PLAY_SECONDS * 1000; t += 33) { // real time: the trace is timed by the renderer's clock
    const tick = Date.now();
    state = model.update(mock.step(0.033), g) || state;
    for (const w of wins) w.webContents.send('overlay:state', pickState(state, def.needs));
    await sleep(Math.max(0, 33 - (Date.now() - tick)));
  }
  for (const w of wins) await w.webContents.executeJavaScript(`document.querySelectorAll('*').forEach((e) => { e.style.animation = 'none'; }); 1`);
  await sleep(80);
  const shots = [];
  for (const w of wins) {
    const img = await w.webContents.capturePage();
    shots.push({ url: img.toDataURL(), h: w.getSize()[1] });
  }

  const page = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await page.loadURL('data:text/html,<body></body>');
  const data = await page.webContents.executeJavaScript(`(async () => {
    const S = ${SCALE}, shots = ${JSON.stringify(shots)}, configs = ${JSON.stringify(CONFIGS.map((c) => [c[0], c[1]]))};
    const lw = 230, gap = 22, top = 18;
    const H = top + shots.reduce((a, s) => a + s.h + gap, 0);
    const c = document.createElement('canvas'); c.width = (lw + ${W} + 24) * S; c.height = H * S;
    const g = c.getContext('2d'); g.scale(S, S);
    const bg = g.createLinearGradient(0, 0, c.width / S, H);
    bg.addColorStop(0, '#1b2438'); bg.addColorStop(1, '#3a2c36');
    g.fillStyle = bg; g.fillRect(0, 0, c.width / S, H);
    let y = top;
    for (const [i, s] of shots.entries()) {
      g.fillStyle = '#e2e8f0'; g.font = '700 15px "Segoe UI", sans-serif';
      g.fillText(configs[i][0], 16, y + s.h / 2 - 4);
      g.fillStyle = '#94a3b8'; g.font = '13px "Segoe UI", sans-serif';
      const words = configs[i][1].split(' '); let line = '', ly = y + s.h / 2 + 14;
      for (const w of words) { if (g.measureText(line + w).width > lw - 30) { g.fillText(line, 16, ly); line = ''; ly += 16; } line += w + ' '; }
      g.fillText(line, 16, ly);
      const im = new Image(); im.src = s.url; await im.decode();
      g.drawImage(im, lw, y, ${W}, s.h);
      y += s.h + gap;
    }
    return c.toDataURL('image/png');
  })()`);
  fs.writeFileSync(OUT, Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', OUT);
  app.quit();
});
