/*
 * Generates the README GIFs in docs/gifs from a scripted demo drive.
 * Usage: npm run gifs
 *
 * Runs the real app off-screen on demo data, drives the player's inputs from a
 * timeline (launch with wheelspin, revving through the gears into the blue
 * over-rev strobe, hard braking with a lock-up, corner exit with wheelspin),
 * captures the Dashboard, Speed and Delta overlay windows and encodes GIFs.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const OUT = path.join(__dirname, '..', 'docs', 'gifs');
process.env.IRO_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-gifs-'));
process.env.IRO_DEMO_SKIP = process.env.IRO_DEMO_SKIP || '300';
process.env.IRO_OFFSCREEN = '1';
for (const a of ['--demo', '--hidden']) if (!process.argv.includes(a)) process.argv.push(a);

require('../src/main/main.js');
const { app } = require('electron');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DURATION = 10.5; // s
const FRAME_MS = 70;
const BG = [15, 18, 23]; // backdrop behind transparent overlay pixels
const MAX_W = 900;

// The demo car's gearbox: speed (m/s) at 8200 rpm in each gear (see mock.js).
const TOPS = [0, 20, 32, 44, 56, 68, 92];
const rpmFor = (v, g) => (v / TOPS[g]) * 8200;
const lerp = (a, b, f) => a + (b - a) * Math.max(0, Math.min(1, f));

// Timeline: returns the player's inputs at time T (seconds since the start).
function inputsAt(T) {
  const o = { throttle: 0, brake: 0, clutch: 1, steer: 0.04 * Math.sin(T * 3), gear: 1, speed: 10, slip: 1 };
  if (T < 0.9) { // launch in 1st, wheels spinning half-way through
    o.gear = 1; o.throttle = 1; o.speed = lerp(7, 18.5, T / 0.9);
    if (T > 0.45) o.slip = 1.14;
  } else if (T < 5.5) { // 2nd..5th: rev each gear into the blue strobe, then shift
    const k = Math.min(3, Math.floor((T - 0.9) / 1.15));
    const f = (T - 0.9 - k * 1.15) / 1.15;
    o.gear = 2 + k; o.throttle = 1;
    const rpm = lerp(5600, 8160, f);
    o.speed = (rpm / 8200) * TOPS[o.gear];
    if (f < 0.05) o.clutch = 0;
  } else if (T < 7.5) { // hard braking; rear wheels lock early in the stop
    const f = (T - 5.5) / 2;
    o.brake = T < 6.4 ? 1 : lerp(0.7, 0.2, (T - 6.4) / 1.1);
    o.speed = lerp(66, 22, f);
    o.gear = T < 6.35 ? 5 : o.speed > 42 ? 4 : o.speed > 30 ? 3 : 2;
    if (T > 5.75 && T < 6.3) o.slip = 0.76;
  } else { // corner exit: steer, feed the throttle in, a little wheelspin in 2nd
    const f = (T - 7.5) / 3;
    o.gear = T < 9.3 ? 2 : 3;
    o.throttle = lerp(0.25, 1, f * 1.6);
    o.speed = lerp(22, 38, f);
    o.steer = 1.3 * Math.sin(Math.min(1, f * 1.3) * Math.PI) * (T < 9 ? 1 : 0.6);
    if (T > 8.5 && T < 9.0) o.slip = 1.12;
  }
  o.rpm = Math.max(900, rpmFor(o.speed, o.gear) * o.slip);
  return o;
}

function scriptedDrive(t0) {
  return (vars, mock) => {
    const T = (mock.sessionTime - t0) % DURATION;
    const o = inputsAt(T);
    Object.assign(vars, {
      Speed: o.speed, VelocityX: o.speed, RPM: o.rpm, Gear: o.gear, Throttle: o.throttle, Brake: o.brake, Clutch: o.clutch,
      SteeringWheelAngle: o.steer, BrakeABSactive: false,
      // delta swings between gaining and losing time
      LapDeltaToBestLap: 0.32 * Math.sin(T * 1.2) + 0.08 * Math.sin(T * 3.1),
      LapDeltaToBestLap_DD: 0.38 * Math.cos(T * 1.2), LapDeltaToBestLap_OK: true,
    });
  };
}

// BGRA bitmap -> RGBA over the backdrop color.
function toRgba(img) {
  const { width, height } = img.getSize();
  const src = img.toBitmap();
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = src[i * 4 + 3] / 255;
    out[i * 4] = src[i * 4 + 2] * a + BG[0] * (1 - a);
    out[i * 4 + 1] = src[i * 4 + 1] * a + BG[1] * (1 - a);
    out[i * 4 + 2] = src[i * 4] * a + BG[2] * (1 - a);
    out[i * 4 + 3] = 255;
  }
  return { data: out, width, height };
}

function encode(frames, file) {
  const { width, height } = frames[0];
  // one palette for the whole GIF (sampled from every 8th frame): smaller and no flicker
  const sample = frames.filter((_, i) => i % 8 === 0);
  const joined = new Uint8Array(sample.reduce((n, f) => n + f.data.length, 0));
  let off = 0;
  for (const f of sample) { joined.set(f.data, off); off += f.data.length; }
  const palette = quantize(joined, 256);
  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const index = applyPalette(f.data, palette);
    gif.writeFrame(index, width, height, i === 0 ? { palette, delay: f.delay, repeat: 0 } : { delay: f.delay });
  });
  gif.finish();
  fs.writeFileSync(file, gif.bytes());
  return (fs.statSync(file).size / 1024).toFixed(0);
}

app.whenReady().then(async () => {
  const S = global.__slipstream;
  await sleep(3500);
  S.mock.script = scriptedDrive(S.mock.sessionTime);
  await sleep(600); // let the first scripted frames reach the overlays

  const ids = ['dash', 'speed', 'delta'];
  const frames = Object.fromEntries(ids.map((id) => [id, []]));
  const start = Date.now();
  let last = start;
  while (Date.now() - start < DURATION * 1000) {
    const tick = Date.now();
    const imgs = await Promise.all(ids.map((id) => S.overlayWins.get(id).win.webContents.capturePage()));
    const now = Date.now();
    const delay = Math.max(20, Math.round((now - last) / 10) * 10);
    last = now;
    if (process.env.IRO_GIF_FRAMES) { // debug: save frames at given times (s) as PNG
      const tSec = (now - start) / 1000;
      for (const want of process.env.IRO_GIF_FRAMES.split(',').map(Number)) {
        if (Math.abs(tSec - want) < FRAME_MS / 2000) imgs.forEach((img, k) => fs.writeFileSync(path.join(os.tmpdir(), `gif-${ids[k]}-${want}.png`), img.toPNG()));
      }
    }
    imgs.forEach((img, k) => {
      let im = img;
      if (im.getSize().width > MAX_W) im = im.resize({ width: MAX_W, quality: 'best' });
      frames[ids[k]].push({ ...toRgba(im), delay });
    });
    const wait = FRAME_MS - (Date.now() - tick);
    if (wait > 0) await sleep(wait);
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const id of ids) {
    const f = frames[id];
    // all frames must match the first frame's size (the box can settle a pixel or two)
    const { width, height } = f[0];
    const same = f.filter((x) => x.width === width && x.height === height);
    const kb = encode(same, path.join(OUT, id + '.gif'));
    console.log(`${id}.gif ${width}x${height} ${same.length} frames ${kb} KB`);
  }
  app.quit();
});
