/*
 * iRacing SDK reader: maps the "Local\IRSDKMemMapFileName" shared memory
 * through kernel32 (via koffi, no native build needed) and decodes the
 * telemetry variable buffer and the session info YAML.
 */
const koffi = require('koffi');
const yaml = require('js-yaml');

const MEMMAP_NAME = 'Local\\IRSDKMemMapFileName';
const FILE_MAP_READ = 0x0004;
const STATUS_CONNECTED = 1;

// Header layout (irsdk_defines.h)
const H = { ver: 0, status: 4, tickRate: 8, sessionInfoUpdate: 12, sessionInfoLen: 16, sessionInfoOffset: 20, numVars: 24, varHeaderOffset: 28, numBuf: 32, bufLen: 36, varBuf: 48 };
const VAR_HEADER_SIZE = 144;
const TYPE_SIZE = [1, 1, 4, 4, 4, 8]; // char, bool, int, bitfield, float, double

// Variables we care about. Anything missing in a given car/session is simply undefined.
const WANTED = new Set([
  'SessionTime', 'SessionTick', 'SessionNum', 'SessionState', 'SessionFlags', 'SessionTimeRemain', 'SessionLapsRemainEx', 'SessionTimeTotal', 'SessionLapsTotal', 'SessionTimeOfDay',
  'PlayerCarIdx', 'PlayerCarPosition', 'PlayerCarClassPosition', 'PlayerCarMyIncidentCount', 'PlayerCarTeamIncidentCount', 'PlayerCarDriverIncidentCount', 'PlayerTrackSurface', 'PlayerCarInPitStall',
  'IsOnTrack', 'IsOnTrackCar', 'IsInGarage', 'IsReplayPlaying', 'OnPitRoad', 'CamCarIdx', 'DisplayUnits',
  'CarIdxLap', 'CarIdxLapCompleted', 'CarIdxLapDistPct', 'CarIdxTrackSurface', 'CarIdxOnPitRoad', 'CarIdxPosition', 'CarIdxClassPosition', 'CarIdxF2Time', 'CarIdxEstTime', 'CarIdxLastLapTime', 'CarIdxBestLapTime', 'CarIdxGear', 'CarIdxRPM', 'CarIdxSessionFlags', 'CarIdxTireCompound', 'CarIdxFastRepairsUsed',
  'CarLeftRight',
  'Speed', 'RPM', 'Gear', 'Throttle', 'Brake', 'Clutch', 'SteeringWheelAngle', 'SteeringWheelAngleMax', 'BrakeABSactive', 'ShiftIndicatorPct',
  'FuelLevel', 'FuelLevelPct', 'FuelUsePerHour',
  'Lap', 'LapCompleted', 'LapDistPct', 'LapDist', 'LapCurrentLapTime', 'LapLastLapTime', 'LapBestLapTime',
  'LapDeltaToBestLap', 'LapDeltaToBestLap_DD', 'LapDeltaToBestLap_OK',
  'LapDeltaToOptimalLap', 'LapDeltaToOptimalLap_DD', 'LapDeltaToOptimalLap_OK',
  'LapDeltaToSessionBestLap', 'LapDeltaToSessionBestLap_DD', 'LapDeltaToSessionBestLap_OK',
  'LapDeltaToSessionOptimalLap', 'LapDeltaToSessionOptimalLap_DD', 'LapDeltaToSessionOptimalLap_OK',
  'LapDeltaToSessionLastlLap', 'LapDeltaToSessionLastlLap_DD', 'LapDeltaToSessionLastlLap_OK',
  'AirTemp', 'TrackTempCrew', 'TrackWetness', 'Skies', 'WindVel', 'WindDir', 'RelativeHumidity',
  'VelocityX', 'VelocityY', 'Yaw',
  'WaterTemp', 'OilTemp', 'OilPress', 'Voltage', 'EngineWarnings', 'dcBrakeBias',
  'PitSvFuel', 'PitRepairLeft', 'PitOptRepairLeft',
]);

let k32 = null;
function kernel32() {
  if (!k32) {
    const lib = koffi.load('kernel32.dll');
    k32 = {
      OpenFileMappingW: lib.func('void* __stdcall OpenFileMappingW(uint32_t access, int inherit, str16 name)'),
      MapViewOfFile: lib.func('void* __stdcall MapViewOfFile(void* h, uint32_t access, uint32_t offHi, uint32_t offLo, size_t bytes)'),
      UnmapViewOfFile: lib.func('int __stdcall UnmapViewOfFile(void* p)'),
      CloseHandle: lib.func('int __stdcall CloseHandle(void* h)'),
      VirtualQuery: lib.func('size_t __stdcall VirtualQuery(void* addr, void* info, size_t len)'),
    };
  }
  return k32;
}

const cp1252 = new TextDecoder('windows-1252');

// iRacing's YAML is not always valid YAML (unquoted names with ':' '#' '*' etc).
// Quote any scalar value that could confuse the parser.
function sanitizeYaml(text) {
  return text.replace(/^(\s*(?:- )?[A-Za-z0-9_]+: )(.+?)\s*$/gm, (m, key, val) => {
    if (/^['"]/.test(val)) return m;
    if (/^[-+]?[0-9.]+$/.test(val) || /^0x[0-9a-fA-F]+$/.test(val)) return m;
    if (/[:#*&!%@`{}\[\],|>]/.test(val) || /^[-?]/.test(val)) return key + "'" + val.replace(/'/g, "''") + "'";
    return m;
  });
}

function parseSessionInfo(text) {
  try {
    return yaml.load(sanitizeYaml(text), { json: true }) || {};
  } catch (e) {
    console.error('Session info parse failed:', e.message);
    return null;
  }
}

class IRacingReader {
  constructor() {
    this.handle = null;
    this.ptr = null;
    this.view = null;
    this.vars = null; // [{name,type,offset,count}]
    this.lastSessionInfoUpdate = -1;
    this.sessionInfo = null;
    this.lastTick = -1;
  }

  // Try to (re)open the memory map. Returns true when a map is open.
  open() {
    if (this.view) return true;
    if (process.platform !== 'win32') return false;
    const k = kernel32();
    const h = k.OpenFileMappingW(FILE_MAP_READ, 0, MEMMAP_NAME);
    if (!h) return false;
    const p = k.MapViewOfFile(h, FILE_MAP_READ, 0, 0, 0);
    if (!p) { k.CloseHandle(h); return false; }
    // Determine mapping size via VirtualQuery (MEMORY_BASIC_INFORMATION.RegionSize @ offset 24 on x64).
    const info = Buffer.alloc(48);
    k.VirtualQuery(p, info, 48);
    const size = Number(info.readBigUInt64LE(24)) || 1164 * 1024;
    this.handle = h;
    this.ptr = p;
    this.view = new DataView(koffi.view(p, size));
    this.size = size;
    this.vars = null;
    this.lastSessionInfoUpdate = -1;
    return true;
  }

  close() {
    if (!this.view) return;
    const k = kernel32();
    try { k.UnmapViewOfFile(this.ptr); k.CloseHandle(this.handle); } catch (_) { /* ignore */ }
    this.view = this.ptr = this.handle = this.vars = null;
    this.sessionInfo = null;
  }

  i32(off) { return this.view.getInt32(off, true); }

  str(off, len) {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + off, len);
    let end = bytes.indexOf(0);
    if (end < 0) end = len;
    return cp1252.decode(bytes.subarray(0, end));
  }

  get connected() {
    return !!this.view && (this.i32(H.status) & STATUS_CONNECTED) !== 0;
  }

  readVarHeaders() {
    const n = this.i32(H.numVars);
    const base = this.i32(H.varHeaderOffset);
    const vars = [];
    for (let i = 0; i < n; i++) {
      const o = base + i * VAR_HEADER_SIZE;
      const name = this.str(o + 16, 32);
      if (!WANTED.has(name)) continue;
      vars.push({ name, type: this.i32(o), offset: this.i32(o + 4), count: this.i32(o + 8) });
    }
    this.vars = vars;
  }

  decode(buf, v) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const read = (off) => {
      switch (v.type) {
        case 0: return dv.getUint8(off);
        case 1: return dv.getUint8(off) !== 0;
        case 2: case 3: return dv.getInt32(off, true);
        case 4: return dv.getFloat32(off, true);
        case 5: return dv.getFloat64(off, true);
        default: return undefined;
      }
    };
    if (v.count === 1) return read(v.offset);
    const arr = new Array(v.count);
    const sz = TYPE_SIZE[v.type];
    for (let i = 0; i < v.count; i++) arr[i] = read(v.offset + i * sz);
    return arr;
  }

  // Returns a frame or null if nothing new / not connected.
  read() {
    if (!this.open()) return null;
    if (!this.connected) {
      this.vars = null;
      this.lastSessionInfoUpdate = -1;
      return null;
    }
    if (!this.vars) this.readVarHeaders();

    // Session info (only re-parse when iRacing bumps the counter)
    const siu = this.i32(H.sessionInfoUpdate);
    if (siu !== this.lastSessionInfoUpdate) {
      const text = this.str(this.i32(H.sessionInfoOffset), this.i32(H.sessionInfoLen));
      const parsed = parseSessionInfo(text);
      if (parsed) { this.sessionInfo = parsed; this.lastSessionInfoUpdate = siu; }
    }

    // Pick the most recent buffer and copy it out; retry if iRacing wrote to it mid-copy.
    const numBuf = this.i32(H.numBuf);
    const bufLen = this.i32(H.bufLen);
    for (let attempt = 0; attempt < 3; attempt++) {
      let best = 0, bestTick = -1;
      for (let i = 0; i < numBuf; i++) {
        const t = this.i32(H.varBuf + i * 16);
        if (t > bestTick) { bestTick = t; best = i; }
      }
      if (bestTick === this.lastTick) return null;
      const off = this.i32(H.varBuf + best * 16 + 4);
      const copy = Buffer.from(new Uint8Array(this.view.buffer, this.view.byteOffset + off, bufLen));
      if (this.i32(H.varBuf + best * 16) !== bestTick) continue;
      this.lastTick = bestTick;
      const vars = {};
      for (const v of this.vars) vars[v.name] = this.decode(copy, v);
      return { vars, sessionInfo: this.sessionInfo, sessionInfoUpdate: this.lastSessionInfoUpdate, tickRate: this.i32(H.tickRate) };
    }
    return null;
  }
}

module.exports = { IRacingReader, parseSessionInfo, sanitizeYaml };
