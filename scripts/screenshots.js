/*
 * Generates the README screenshots in docs/screenshots from the demo race.
 * Usage: npm run screenshots
 *
 * Runs the real app in demo mode with an isolated config, stages a moment
 * (car alongside, cars close ahead/behind), captures every overlay window with
 * transparency, then composites them onto a painted backdrop.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
process.env.IRO_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-shots-'));
// the track map is off on a fresh install; switch it on so it's in the pictures
fs.writeFileSync(path.join(process.env.IRO_USERDATA, 'overlay-config.json'), JSON.stringify({ activeProfile: 'default', profiles: { default: { name: 'Default', overlays: { trackmap: { enabled: true } } } } }));
process.env.IRO_DEMO_SKIP = process.env.IRO_DEMO_SKIP || '520';
process.env.IRO_OFFSCREEN = '1'; // render off-screen so nothing pops up on the desktop
if (!process.argv.includes('--demo')) process.argv.push('--demo');

require('../src/main/main.js');
const { app, BrowserWindow } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(win) {
  const img = await win.webContents.capturePage();
  return { url: img.toDataURL(), width: img.getSize().width };
}

// Paint a dusk "cockpit view" backdrop and draw overlays on top, in page JS.
function composeScript(W, H, items, scene) {
  return `(async () => {
    const W = ${W}, H = ${H};
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const scene = ${JSON.stringify(scene)};
    // sky
    let sky = g.createLinearGradient(0, 0, 0, H * .55);
    sky.addColorStop(0, '#0b1426'); sky.addColorStop(.55, '#3b2a4a'); sky.addColorStop(1, '#d9774a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const sun = g.createRadialGradient(W * .62, H * .5, 10, W * .62, H * .5, H * .5);
    sun.addColorStop(0, 'rgba(255,190,120,.85)'); sun.addColorStop(1, 'rgba(255,150,90,0)');
    g.fillStyle = sun; g.fillRect(0, 0, W, H);
    // hills
    const hills = (y, amp, col, seed) => {
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, y + Math.sin(x / (170 + seed * 40) + seed) * amp + Math.sin(x / 57 + seed * 3) * amp * .25);
      g.lineTo(W, H); g.closePath(); g.fillStyle = col; g.fill();
    };
    hills(H * .5, 26, '#2a2238', 1); hills(H * .54, 18, '#1a1726', 2);
    // grass
    const grass = g.createLinearGradient(0, H * .55, 0, H);
    grass.addColorStop(0, '#1d2a1c'); grass.addColorStop(1, '#0c140c');
    g.fillStyle = grass; g.fillRect(0, H * .55, W, H * .45);
    // track in perspective, curving right
    const vx = W * .58, vy = H * .56;
    const road = (t) => { const y = vy + (H - vy) * t; const cx = vx + (W * .5 - vx) * t + Math.pow(1 - t, 2) * W * .12; const hw = 12 + t * W * .62; return [cx, y, hw]; };
    const strip = (from, to, color, side) => {
      g.beginPath();
      for (let i = 0; i <= 40; i++) { const t = i / 40; const [cx, y, hw] = road(t); g.lineTo(cx + side * hw * from, y); }
      for (let i = 40; i >= 0; i--) { const t = i / 40; const [cx, y, hw] = road(t); g.lineTo(cx + side * hw * to, y); }
      g.closePath(); g.fillStyle = color; g.fill();
    };
    const asphalt = g.createLinearGradient(0, vy, 0, H);
    asphalt.addColorStop(0, '#3a3a44'); asphalt.addColorStop(1, '#17171c');
    strip(0, 1, asphalt, -1); strip(0, 1, asphalt, 1);
    strip(.96, 1.0, '#e5e7eb', -1); strip(.96, 1.0, '#e5e7eb', 1);
    // kerbs
    for (let i = 0; i < 28; i++) {
      const t0 = Math.pow(i / 28, 1.6), t1 = Math.pow((i + 1) / 28, 1.6);
      for (const side of [-1, 1]) {
        g.beginPath();
        const a = road(t0), b = road(t1);
        g.moveTo(a[0] + side * a[2], a[1]); g.lineTo(b[0] + side * b[2], b[1]);
        g.lineTo(b[0] + side * b[2] * 1.07, b[1]); g.lineTo(a[0] + side * a[2] * 1.07, a[1]);
        g.fillStyle = i % 2 ? '#dc2626' : '#f5f5f5'; g.fill();
      }
    }
    // cockpit: dashboard cowl
    g.fillStyle = '#050608';
    g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * .9); g.quadraticCurveTo(W * .5, H * .8, W, H * .9); g.lineTo(W, H); g.fill();
    // vignette
    const vig = g.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .95);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
    if (scene.crop) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, H); }
    // overlays
    for (const it of ${JSON.stringify(items)}) {
      const img = new Image(); img.src = it.url; await img.decode();
      g.drawImage(img, it.x, it.y, it.w, it.h);
    }
    return c.toDataURL('image/png');
  })()`;
}

async function compose(W, H, items, scene = {}) {
  const win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const url = await win.webContents.executeJavaScript(composeScript(W, H, items, scene));
  win.destroy();
  return Buffer.from(url.split(',')[1], 'base64');
}

app.whenReady().then(async () => {
  const S = global.__slipstream;
  await sleep(2500);
  // stage: one car alongside on the left, one close ahead, one behind; blue flag out
  S.mock.pinned = [{ idx: 11, meters: -1.8 }, { idx: 13, meters: 11 }, { idx: 15, meters: -8 }];
  S.mock.flagOverride = 0x4 | 0x20;
  await sleep(4500);

  fs.mkdirSync(OUT, { recursive: true });
  const shots = {};
  for (const [id, o] of S.overlayWins) shots[id] = await capture(o.win);
  const cfg = S.config;
  const place = (id, dx = 0, dy = 0) => {
    const b = cfg.overlay(id).bounds;
    return { url: shots[id].url, x: b.x + dx, y: b.y + dy, w: b.width, h: b.height };
  };

  // hero: every overlay in its default layout over a 1920x1080 backdrop
  fs.writeFileSync(path.join(OUT, 'hero.png'), await compose(1920, 1080, Object.keys(shots).map((id) => place(id))));

  // close-ups: each overlay on its own backdrop crop with padding
  const pad = 28;
  for (const id of Object.keys(shots)) {
    const b = cfg.overlay(id).bounds;
    const buf = await compose(b.width + pad * 2, b.height + pad * 2, [{ url: shots[id].url, x: pad, y: pad, w: b.width, h: b.height }], { crop: true });
    fs.writeFileSync(path.join(OUT, id + '.png'), buf);
  }

  // Relative comparison: a mixed GT3 / LMP2 pack (grouped by class), then the same pack as a one-class race
  const relShot = async (name) => {
    await sleep(2500);
    const img = await capture(S.overlayWins.get('relative').win);
    const rb = cfg.overlay('relative').bounds;
    fs.writeFileSync(path.join(OUT, name), await compose(rb.width + pad * 2, rb.height + pad * 2, [{ url: img.url, x: pad, y: pad, w: rb.width, h: rb.height }], { crop: true }));
  };
  S.mock.pinned = [{ idx: 13, meters: 11 }, { idx: 15, meters: -8 }, { idx: 12, meters: 35 },
    { idx: 2, meters: 25 }, { idx: 6, meters: 55 }, { idx: 4, meters: -25 }, { idx: 8, meters: -45 }, { idx: 3, meters: -70 }];
  [10, 11, 14, 16, 17, 18, 19, 20, 21, 22].forEach((idx, n) => S.mock.pinned.push({ idx, meters: (n % 2 ? -1 : 1) * (150 + n * 120) }));
  await relShot('relative.png');
  const gt3 = S.mock.cars.find((c) => !c.pace && c.cls.short === 'GT3').cls;
  for (const c of S.mock.cars) if (!c.pace) c.cls = gt3;
  S.mock.buildSessionInfo();
  S.mock.sessionInfoUpdate++;
  await relShot('relative-single.png');

  // settings pages
  S.openSettings();
  for (const page of ['home', 'ov:standings', 'appearance']) {
    await S.settingsWin.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'settings.html'), { query: { page } });
    await sleep(1500);
    const img = await S.settingsWin.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'settings-' + page.replace('ov:', '') + '.png'), img.resize({ width: 1180 * 1.25, quality: 'best' }).toPNG());
  }
  console.log('screenshots written to', OUT);
  app.quit();
});
