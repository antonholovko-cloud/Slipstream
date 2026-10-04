/*
 * Renders the country flags (flag-icons, MIT) to small PNGs in src/renderer/flags and
 * writes src/main/countries.json (code -> name) for matching iRacing's FlairName.
 * Usage: npx electron scripts/build-flags.js   (only needed when flag-icons is updated)
 *
 * PNGs instead of the SVGs: a few SVGs are large (coats of arms), the build skips
 * src/**\/*.svg, and the overlays only ever draw flags a few pixels tall.
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const SRC = path.join(__dirname, '..', 'node_modules', 'flag-icons');
const OUT = path.join(__dirname, '..', 'src', 'renderer', 'flags');
const W = 48, H = 36; // 4:3, crisp at 2x for the ~18 px the overlays draw at large scales

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const list = JSON.parse(fs.readFileSync(path.join(SRC, 'country.json'), 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const countries = {};
  for (const c of list) {
    const svg = fs.readFileSync(path.join(SRC, c.flag_4x3), 'utf8');
    const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    const png = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image(); img.src = ${JSON.stringify(url)}; await img.decode();
      const cv = document.createElement('canvas'); cv.width = ${W}; cv.height = ${H};
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, ${W}, ${H});
      return cv.toDataURL('image/png');
    })()`);
    fs.writeFileSync(path.join(OUT, c.code + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    countries[c.code] = c.name;
  }
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'main', 'countries.json'), JSON.stringify(countries, null, 1) + '\n');
  fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(OUT, 'LICENSE-flag-icons.txt'));
  console.log(`${list.length} flags written to ${OUT}`);
  app.quit();
});
