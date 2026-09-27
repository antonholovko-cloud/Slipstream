/*
 * Renders the app icon (SVG below) to src/assets/icon.png at 512px.
 * Usage: npx electron scripts/render-icon.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2433"/><stop offset="1" stop-color="#07090d"/>
    </linearGradient>
    <linearGradient id="white" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset=".45" stop-color="#f1f5f9"/><stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#e11d48" stop-opacity="0"/><stop offset=".45" stop-color="#e11d48"/><stop offset="1" stop-color="#fb7185"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="none" stroke="#e11d48" stroke-width="10" opacity=".9"/>
  <!-- slipstream: an S drawn as two flowing speed lines that fade out at their tails -->
  <path d="M430 150 C 370 96, 190 92, 140 160 C 104 212, 170 250, 262 256"
        fill="none" stroke="url(#white)" stroke-width="48" stroke-linecap="round"/>
  <path d="M250 256 C 342 262, 408 300, 372 352 C 322 420, 142 416, 82 362"
        fill="none" stroke="url(#red)" stroke-width="48" stroke-linecap="round"/>
  <path d="M300 440 L 440 440" stroke="#e11d48" stroke-width="12" stroke-linecap="round" opacity=".5"/>
  <path d="M72 72 L 212 72" stroke="#f1f5f9" stroke-width="12" stroke-linecap="round" opacity=".35"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' });
  const out = path.join(__dirname, '..', 'src', 'assets');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), img.toPNG());
  fs.writeFileSync(path.join(out, 'icon.svg'), svg);
  console.log('icon written', img.getSize());
  app.quit();
});
