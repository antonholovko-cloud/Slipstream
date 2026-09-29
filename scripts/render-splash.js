/*
 * Renders build/portable-splash.bmp: shown by the portable exe while it unpacks
 * (which takes a few seconds on first start, with no other feedback).
 * Usage: npx electron scripts/render-splash.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 480, H = 240;
const icon = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'icon.png')).toString('base64');
const html = `<html><head><meta charset="utf-8"></head><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:linear-gradient(135deg,#0b0f17,#06080c 60%,#1a0710);
  font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;gap:22px;color:#fff">
  <img src="data:image/png;base64,${icon}" width="96" height="96">
  <div><div style="font-size:34px;font-weight:700;letter-spacing:.04em">Slipstream</div>
  <div style="font-size:15px;color:#94a3b8;margin-top:6px">Starting… this takes a few seconds the first time</div>
  <div style="margin-top:14px;height:4px;width:230px;border-radius:2px;background:#1f2937;overflow:hidden"><div style="height:100%;width:62%;background:#e11d48"></div></div></div>
</body></html>`;

// 24-bit bottom-up BMP from a BGRA bitmap
function toBmp(bgra, w, h) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    const dst = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      b[dst + x * 3] = bgra[s]; b[dst + x * 3 + 1] = bgra[s + 1]; b[dst + x * 3 + 2] = bgra[s + 2];
    }
  }
  return b;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = (await win.webContents.capturePage()).resize({ width: W, height: H, quality: 'best' });
  const out = path.join(__dirname, '..', 'build', 'portable-splash.bmp');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, toBmp(img.toBitmap(), W, H));
  console.log('splash written', out);
  app.quit();
});
