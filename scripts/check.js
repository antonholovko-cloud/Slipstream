/*
 * Self-test: creates a fake iRacing shared-memory map (same binary layout as the
 * real sim), then runs the real IRacingReader + RaceModel against it.
 * Usage: npm run check
 */
const koffi = require('koffi');
const assert = require('assert');

const lib = koffi.load('kernel32.dll');
const CreateFileMappingW = lib.func('void* __stdcall CreateFileMappingW(void* f, void* s, uint32_t p, uint32_t hi, uint32_t lo, str16 n)');
const MapViewOfFile = lib.func('void* __stdcall MapViewOfFile(void* h, uint32_t a, uint32_t hi, uint32_t lo, size_t n)');

const SIZE = 1164 * 1024;
const h = CreateFileMappingW(null, null, 0x04 /* PAGE_READWRITE */, 0, SIZE, 'Local\\IRSDKMemMapFileName');
assert(h, 'CreateFileMapping failed (is iRacing running? close it for this test)');
const p = MapViewOfFile(h, 0xF001F, 0, 0, 0);
const buf = Buffer.from(koffi.view(p, SIZE));
const mem = new DataView(koffi.view(p, SIZE));

// ---- var headers ----
const vars = [
  ['SessionTime', 5, 1], ['SessionNum', 2, 1], ['SessionState', 2, 1], ['SessionFlags', 3, 1], ['SessionLapsRemainEx', 2, 1], ['SessionTimeRemain', 5, 1],
  ['PlayerCarIdx', 2, 1], ['IsOnTrack', 1, 1], ['Speed', 4, 1], ['RPM', 4, 1], ['Gear', 2, 1], ['Throttle', 4, 1], ['Brake', 4, 1], ['Clutch', 4, 1],
  ['FuelLevel', 4, 1], ['LapCompleted', 2, 1], ['CarLeftRight', 3, 1],
  ['CarIdxLapDistPct', 4, 64], ['CarIdxPosition', 2, 64], ['CarIdxClassPosition', 2, 64], ['CarIdxLapCompleted', 2, 64], ['CarIdxTrackSurface', 2, 64],
  ['CarIdxOnPitRoad', 1, 64], ['CarIdxEstTime', 4, 64], ['CarIdxF2Time', 4, 64], ['CarIdxLastLapTime', 4, 64], ['CarIdxBestLapTime', 4, 64],
  ['SomeUnwantedVar', 4, 1],
];
const SZ = [1, 1, 4, 4, 4, 8];
const VAR_OFF = 144;
let off = 0;
const layout = {};
vars.forEach(([name, type, count], i) => {
  const o = VAR_OFF + i * 144;
  mem.setInt32(o, type, true);
  mem.setInt32(o + 4, off, true);
  mem.setInt32(o + 8, count, true);
  buf.write(name, o + 16, 'latin1');
  layout[name] = { type, off, count };
  off += SZ[type] * count;
});
const bufLen = off;

// ---- session info ----
const yaml = `---
WeekendInfo:
 TrackName: spa
 TrackID: 163
 TrackLength: 6.93 km
 TrackDisplayName: Circuit de Spa-Francorchamps
 TrackConfigName: Grand Prix Pits
 WeekendOptions:
  IncidentLimit: 25
SessionInfo:
 Sessions:
 - SessionNum: 0
   SessionLaps: 20
   SessionTime: 3600.0000 sec
   SessionType: Race
   SessionName: RACE
DriverInfo:
 DriverCarIdx: 1
 DriverCarFuelMaxLtr: 120.000
 DriverCarRedLine: 8500.000
 DriverCarSLFirstRPM: 7000.000
 DriverCarSLShiftRPM: 8000.000
 DriverCarSLLastRPM: 8200.000
 DriverCarSLBlinkRPM: 8400.000
 DriverCarEstLapTime: 138.5
 Drivers:
 - CarIdx: 0
   UserName: Pace Car
   CarNumber: "0"
   CarClassID: 11
   CarIsPaceCar: 1
   IRating: 0
   LicString: R 0.01
   LicColor: 0xffffff
   CarClassColor: 0xffffff
 - CarIdx: 1
   UserName: José "Speedy" O'Neil: #1 & *Co
   TeamName: Team: Awesome #7
   CarNumber: "7"
   CarClassID: 74
   CarClassShortName: GT3 Class
   CarClassColor: 0xffda59
   CarClassEstLapTime: 138.5
   CarScreenNameShort: BMW M4 GT3
   IRating: 2500
   LicString: A 3.21
   LicColor: 0x0153db
   CarIsPaceCar: 0
   IsSpectator: 0
 - CarIdx: 2
   UserName: Second Driver
   CarNumber: "22"
   CarClassID: 74
   CarClassShortName: GT3 Class
   CarClassColor: 0xffda59
   CarClassEstLapTime: 138.5
   IRating: 1800
   LicString: B 2.10
   LicColor: 0x00c702
   CarIsPaceCar: 0
   IsSpectator: 0
...
`;
const siOff = VAR_OFF + vars.length * 144 + 64;
const siBytes = Buffer.from(yaml, 'latin1');
siBytes.copy(buf, siOff);
const dataOff = siOff + 0x20000;

// header
const H = (o, v) => mem.setInt32(o, v, true);
H(0, 2); H(4, 1); H(8, 60); H(12, 1); H(16, siBytes.length + 1); H(20, siOff);
H(24, vars.length); H(28, VAR_OFF); H(32, 3); H(36, bufLen);
for (let b = 0; b < 3; b++) { H(48 + b * 16, 0); H(48 + b * 16 + 4, dataOff + b * bufLen); }

function writeFrame(tick, values) {
  const b = tick % 3;
  const base = dataOff + b * bufLen;
  for (const [name, val] of Object.entries(values)) {
    const L = layout[name];
    const arr = Array.isArray(val) ? val : [val];
    arr.forEach((v, i) => {
      const o = base + L.off + i * SZ[L.type];
      switch (L.type) {
        case 1: mem.setUint8(o, v ? 1 : 0); break;
        case 2: case 3: mem.setInt32(o, v, true); break;
        case 4: mem.setFloat32(o, v, true); break;
        case 5: mem.setFloat64(o, v, true); break;
      }
    });
  }
  H(48 + b * 16, tick);
}

const arr = (n, f) => Array.from({ length: n }, (_, i) => f(i));
function frameValues(tick) {
  return {
    SessionTime: tick / 60, SessionNum: 0, SessionState: 4, SessionFlags: 0x4, SessionLapsRemainEx: 15, SessionTimeRemain: 1800,
    PlayerCarIdx: 1, IsOnTrack: true, Speed: 50, RPM: 7500, Gear: 4, Throttle: 0.8, Brake: 0, Clutch: 1, FuelLevel: 60 - tick * 0.001, LapCompleted: 4, CarLeftRight: 2,
    CarIdxLapDistPct: arr(64, (i) => (i === 1 ? 0.5 : i === 2 ? 0.49 : -1)),
    CarIdxPosition: arr(64, (i) => (i === 1 ? 1 : i === 2 ? 2 : 0)),
    CarIdxClassPosition: arr(64, (i) => (i === 1 ? 1 : i === 2 ? 2 : 0)),
    CarIdxLapCompleted: arr(64, (i) => (i === 1 || i === 2 ? 4 : -1)),
    CarIdxTrackSurface: arr(64, (i) => (i === 1 || i === 2 ? 3 : -1)),
    CarIdxOnPitRoad: arr(64, () => false),
    CarIdxEstTime: arr(64, (i) => (i === 1 ? 69.2 : i === 2 ? 67.9 : 0)),
    CarIdxF2Time: arr(64, (i) => (i === 2 ? 1.3 : 0)),
    CarIdxLastLapTime: arr(64, (i) => (i === 1 ? 138.9 : i === 2 ? 139.4 : -1)),
    CarIdxBestLapTime: arr(64, (i) => (i === 1 ? 138.2 : i === 2 ? 138.7 : -1)),
  };
}

const { IRacingReader } = require('../src/main/irsdk');
const { RaceModel } = require('../src/main/model');
const reader = new IRacingReader();

writeFrame(1, frameValues(1));
let f = reader.read();
assert(f, 'reader returned a frame');
assert.strictEqual(f.vars.PlayerCarIdx, 1);
assert.strictEqual(f.vars.Gear, 4);
assert.strictEqual(f.vars.IsOnTrack, true);
assert(Math.abs(f.vars.Speed - 50) < 1e-6);
assert.strictEqual(f.vars.CarIdxPosition[2], 2);
assert.strictEqual(f.vars.SomeUnwantedVar, undefined, 'unwanted vars are skipped');
const drv = f.sessionInfo.DriverInfo.Drivers[1];
assert.strictEqual(drv.UserName, 'José "Speedy" O\'Neil: #1 & *Co', 'YAML sanitizer keeps odd names intact');
assert.strictEqual(drv.TeamName, 'Team: Awesome #7');
assert.strictEqual(reader.read(), null, 'no new frame when tick unchanged');

writeFrame(2, frameValues(2));
f = reader.read();
assert(f && f.vars.SessionTime > 0, 'reads newest buffer');

const model = new RaceModel({});
const st = model.update(f, { units: 'auto', focusCamCar: true });
assert.strictEqual(st.session.kind, 'race');
assert.strictEqual(st.session.track.name, 'Circuit de Spa-Francorchamps');
assert(Math.abs(st.session.track.length - 6930) < 1);
assert.strictEqual(st.cars.length, 2, 'pace car excluded');
const me = st.cars.find((c) => c.isPlayer);
assert.strictEqual(me.number, '7');
assert.strictEqual(me.classColor, '#ffda59');
assert.strictEqual(me.licColor, '#0153db');
assert.strictEqual(st.relative.length, 1);
assert(Math.abs(st.relative[0].gap - -1.3) < 0.01, 'relative gap from est time: ' + st.relative[0].gap);
assert.strictEqual(st.classes[0].sof > 1800 && st.classes[0].sof < 2500, true);
assert(me.irDelta > 0, 'winner gains iRating');
assert.strictEqual(st.player.shift.slShift, 8000);
assert.strictEqual(st.radar.state, 2);

// disconnect
H(4, 0);
assert.strictEqual(reader.read(), null, 'disconnect detected');
assert.strictEqual(reader.connected, false);

console.log('✔ irsdk reader + model self-test passed');
