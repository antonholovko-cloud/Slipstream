const test = require('node:test');
const assert = require('node:assert/strict');
const { IRacingReader, parseSessionInfo, sanitizeYaml } = require('../../src/main/irsdk');

const quiet = (fn) => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

// ---------------- session info YAML ----------------

test('sanitizeYaml quotes values that would confuse the YAML parser', () => {
  const out = sanitizeYaml([
    ' UserName: Max: The #1 Driver',
    ' TeamName: Team & Co *star*',
    ' Abbrev: -dash start',
    ' Q: ?question',
    ' Brackets: [not a list]',
    ' Pipe: a | b',
  ].join('\n'));
  assert.match(out, /UserName: 'Max: The #1 Driver'/);
  assert.match(out, /TeamName: 'Team & Co \*star\*'/);
  assert.match(out, /Abbrev: '-dash start'/);
  assert.match(out, /Q: '\?question'/);
  assert.match(out, /Brackets: '\[not a list\]'/);
  assert.match(out, /Pipe: 'a \| b'/);
});

test('sanitizeYaml leaves numbers, hex, plain words and already-quoted values alone', () => {
  const src = [' TrackID: 163', ' Fuel: -12.5', ' LicColor: 0xffda59', ' TrackName: spa', ' CarNumber: "7"', " Name: 'a: b'", ' Length: 6.93 km'].join('\n');
  assert.equal(sanitizeYaml(src), src);
});

test('sanitizeYaml doubles single quotes inside a value it quotes', () => {
  assert.equal(sanitizeYaml(" UserName: O'Neil: #1"), " UserName: 'O''Neil: #1'");
});

test('sanitizeYaml handles list items', () => {
  assert.equal(sanitizeYaml(' - UserName: A: B'), " - UserName: 'A: B'");
});

test('parseSessionInfo parses iRacing-style YAML with awkward names', () => {
  const info = parseSessionInfo(`---
WeekendInfo:
 TrackName: spa
 TrackID: 163
 LeagueID: 4521
DriverInfo:
 DriverCarIdx: 1
 Drivers:
 - CarIdx: 1
   UserName: José "Speedy" O'Neil: #1 & *Co
   TeamName: Team: Awesome #7 {x}
   CarNumber: "07"
   CarClassColor: 0xffda59
   IRating: 2500
 - CarIdx: 2
   UserName: Ålesund Øyvind-Æ
   TeamName: -- no team --
...
`);
  assert.equal(info.WeekendInfo.TrackID, 163);
  assert.equal(info.WeekendInfo.LeagueID, 4521);
  const [a, b] = info.DriverInfo.Drivers;
  assert.equal(a.UserName, 'José "Speedy" O\'Neil: #1 & *Co');
  assert.equal(a.TeamName, 'Team: Awesome #7 {x}');
  assert.equal(a.CarNumber, '07', 'quoted car numbers stay strings');
  assert.equal(a.IRating, 2500);
  assert.equal(b.UserName, 'Ålesund Øyvind-Æ');
  assert.equal(b.TeamName, '-- no team --');
});

test('parseSessionInfo returns null (never throws) for empty or broken YAML', () => {
  const empty = quiet(() => parseSessionInfo(''));
  assert.ok(empty === null || (typeof empty === 'object' && !Object.keys(empty).length), 'empty input: null or {}');
  assert.equal(quiet(() => parseSessionInfo('a:\n\t- b: [1, 2\n  c: d: e: f\n   - x')), null);
});

// ---------------- reader helpers (no shared memory) ----------------

test('IRacingReader.str decodes cp1252 and stops at the first NUL', () => {
  const b = Buffer.from([0x4a, 0x6f, 0x73, 0xe9, 0x20, 0x80, 0x00, 0x41, 0x42]); // "José €\0AB"
  assert.equal(IRacingReader.str(b, 0, b.length), 'José €');
  assert.equal(IRacingReader.str(Buffer.from('ABC'), 0, 3), 'ABC', 'no terminator');
  assert.equal(IRacingReader.str(Buffer.from('xxABCD'), 2, 2), 'AB', 'offset + length');
});

test('copy() refuses reads outside the mapped view', () => {
  const r = new IRacingReader({ name: 'unused' });
  r.size = 100;
  assert.throws(() => r.copy(90, 20), RangeError);
  assert.throws(() => r.copy(-1, 4), RangeError);
});

test('decode() reads every iRacing variable type, single and arrays', () => {
  const r = new IRacingReader({ name: 'unused' });
  const buf = Buffer.alloc(64);
  buf.writeUInt8(65, 0); // char
  buf.writeUInt8(1, 1); // bool
  buf.writeInt32LE(-7, 4); // int
  buf.writeInt32LE(0x4000, 8); // bitfield
  buf.writeFloatLE(1.5, 12); // float
  buf.writeDoubleLE(123.25, 16); // double
  buf.writeInt32LE(3, 24); buf.writeInt32LE(4, 28); // int[2]
  assert.equal(r.decode(buf, { type: 0, offset: 0, count: 1 }), 65);
  assert.equal(r.decode(buf, { type: 1, offset: 1, count: 1 }), true);
  assert.equal(r.decode(buf, { type: 2, offset: 4, count: 1 }), -7);
  assert.equal(r.decode(buf, { type: 3, offset: 8, count: 1 }), 0x4000);
  assert.equal(r.decode(buf, { type: 4, offset: 12, count: 1 }), 1.5);
  assert.equal(r.decode(buf, { type: 5, offset: 16, count: 1 }), 123.25);
  assert.deepEqual(r.decode(buf, { type: 2, offset: 24, count: 2 }), [3, 4]);
  assert.equal(r.decode(buf, { type: 9, offset: 0, count: 1 }), undefined, 'unknown type');
});

test('the reader targets iRacing\'s map name unless told otherwise', () => {
  assert.equal(new IRacingReader().name, 'Local\\IRSDKMemMapFileName');
  assert.equal(new IRacingReader({ name: 'Local\\X' }).name, 'Local\\X');
});

// ---------------- end to end against a PRIVATE shared-memory map ----------------
// Same binary layout as the sim, under a unique name, so it never touches iRacing's real memory
// (see scripts/check.js).

function fakeSim() {
  const koffi = require('koffi');
  const lib = koffi.load('kernel32.dll');
  const CreateFileMappingW = lib.func('void* __stdcall CreateFileMappingW(void* f, void* s, uint32_t p, uint32_t hi, uint32_t lo, str16 n)');
  const MapViewOfFile = lib.func('void* __stdcall MapViewOfFile(void* h, uint32_t a, uint32_t hi, uint32_t lo, size_t n)');
  const UnmapViewOfFile = lib.func('int __stdcall UnmapViewOfFile(void* p)');
  const CloseHandle = lib.func('int __stdcall CloseHandle(void* h)');
  const GetLastError = lib.func('uint32_t __stdcall GetLastError()');
  const SIZE = 256 * 1024;
  const name = `Local\\SlipstreamUnitTest-${process.pid}-${Math.random().toString(36).slice(2)}`;
  assert.notEqual(name, 'Local\\IRSDKMemMapFileName');
  const h = CreateFileMappingW(null, null, 0x04, 0, SIZE, name);
  assert.ok(h);
  assert.notEqual(GetLastError(), 183, 'refusing to write into an existing map');
  const p = MapViewOfFile(h, 0xF001F, 0, 0, 0);
  const buf = Buffer.from(koffi.view(p, SIZE));
  const mem = new DataView(koffi.view(p, SIZE));
  const SZ = [1, 1, 4, 4, 4, 8];
  const vars = [['SessionTime', 5, 1], ['PlayerCarIdx', 2, 1], ['IsOnTrack', 1, 1], ['Speed', 4, 1], ['Gear', 2, 1], ['SessionFlags', 3, 1],
    ['CarIdxPosition', 2, 8], ['NotWanted', 4, 1]];
  const layout = {};
  let off = 0;
  vars.forEach(([n, type, count], i) => {
    const o = 144 + i * 144;
    mem.setInt32(o, type, true); mem.setInt32(o + 4, off, true); mem.setInt32(o + 8, count, true);
    buf.write(n, o + 16, 'latin1');
    layout[n] = { type, off, count };
    off += SZ[type] * count;
  });
  const bufLen = off;
  const siOff = 144 + vars.length * 144 + 64;
  const dataOff = siOff + 0x8000;
  const H = (o, v) => mem.setInt32(o, v, true);
  const setInfo = (text, update) => {
    const bytes = Buffer.from(text, 'latin1');
    buf.fill(0, siOff, siOff + 0x8000);
    bytes.copy(buf, siOff);
    H(16, bytes.length + 1); H(20, siOff); H(12, update);
  };
  H(0, 2); H(4, 1); H(8, 60); H(24, vars.length); H(28, 144); H(32, 3); H(36, bufLen);
  for (let b = 0; b < 3; b++) { H(48 + b * 16, 0); H(48 + b * 16 + 4, dataOff + b * bufLen); }
  const frame = (tick, values) => {
    const base = dataOff + (tick % 3) * bufLen;
    for (const [n, val] of Object.entries(values)) {
      const L = layout[n];
      (Array.isArray(val) ? val : [val]).forEach((v, i) => {
        const o = base + L.off + i * SZ[L.type];
        if (L.type === 1) mem.setUint8(o, v ? 1 : 0);
        else if (L.type === 2 || L.type === 3) mem.setInt32(o, v, true);
        else if (L.type === 4) mem.setFloat32(o, v, true);
        else mem.setFloat64(o, v, true);
      });
    }
    H(48 + (tick % 3) * 16, tick);
  };
  return { name, setInfo, frame, setStatus: (s) => H(4, s), close: () => { UnmapViewOfFile(p); CloseHandle(h); } };
}

const values = (tick) => ({ SessionTime: tick / 60, PlayerCarIdx: 1, IsOnTrack: true, Speed: 42.5, Gear: 3, SessionFlags: 0x4, CarIdxPosition: [0, 1, 2, 0, 0, 0, 0, 0], NotWanted: 9 });

test('IRacingReader reads frames, session info and disconnects from a private map', { skip: process.platform !== 'win32' && 'needs Windows shared memory' }, () => {
  const sim = fakeSim();
  const r = new IRacingReader({ name: sim.name });
  try {
    sim.setInfo('WeekendInfo:\n TrackName: spa\nDriverInfo:\n Drivers:\n - CarIdx: 1\n   UserName: Driver: #1\n', 1);
    sim.frame(1, values(1));
    let f = r.read();
    assert.ok(f, 'frame');
    assert.ok(r.connected);
    assert.equal(f.vars.PlayerCarIdx, 1);
    assert.equal(f.vars.IsOnTrack, true);
    assert.equal(f.vars.Gear, 3);
    assert.ok(Math.abs(f.vars.Speed - 42.5) < 1e-6);
    assert.equal(f.vars.SessionFlags, 0x4);
    assert.deepEqual(f.vars.CarIdxPosition, [0, 1, 2, 0, 0, 0, 0, 0]);
    assert.equal(f.vars.NotWanted, undefined, 'unlisted variables are skipped');
    assert.equal(f.tickRate, 60);
    assert.equal(f.sessionInfoUpdate, 1);
    assert.equal(f.sessionInfo.DriverInfo.Drivers[0].UserName, 'Driver: #1');

    assert.equal(r.read(), null, 'no new tick -> null');

    // newest of the three buffers wins
    sim.frame(2, { ...values(2), Gear: 4 });
    sim.frame(3, { ...values(3), Gear: 5 });
    f = r.read();
    assert.equal(f.vars.Gear, 5);

    // session info only re-parsed when the update counter changes
    sim.setInfo('WeekendInfo:\n TrackName: monza\n', 2);
    sim.frame(4, values(4));
    f = r.read();
    assert.equal(f.sessionInfo.WeekendInfo.TrackName, 'monza');
    assert.equal(f.sessionInfoUpdate, 2);

    // broken YAML keeps the last good session info
    quiet(() => { sim.setInfo('a:\n\t- b: [1, 2\n  c: d: e: f\n   - x', 3); sim.frame(5, values(5)); f = r.read(); });
    assert.equal(f.sessionInfo.WeekendInfo.TrackName, 'monza');

    // sim disconnects
    sim.setStatus(0);
    sim.frame(6, values(6));
    assert.equal(r.read(), null);
    assert.equal(r.connected, false);

    // and reconnects
    sim.setStatus(1);
    sim.frame(7, values(7));
    f = r.read();
    assert.ok(f);
    assert.equal(f.sessionInfo.WeekendInfo.TrackName, 'monza', 'session info read again after reconnect');
  } finally {
    r.close();
    sim.close();
  }
  assert.equal(r.connected, false);
});

test('IRacingReader.read() returns null when the map does not exist', { skip: process.platform !== 'win32' && 'needs Windows shared memory' }, () => {
  const r = new IRacingReader({ name: `Local\\SlipstreamMissing-${process.pid}` });
  assert.equal(r.open(), false);
  assert.equal(r.read(), null);
  assert.equal(r.connected, false);
  r.close(); // no-op when never opened
});
