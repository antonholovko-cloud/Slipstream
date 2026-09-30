const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// fmt.js is a browser script that sets window.Fmt; run it in a bare vm context.
function loadFmt() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'lib', 'fmt.js'), 'utf8'), ctx);
  return ctx.window.Fmt;
}
const Fmt = loadFmt();

test('esc escapes HTML special characters and handles null', () => {
  assert.equal(Fmt.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(Fmt.esc(null), '');
  assert.equal(Fmt.esc(undefined), '');
  assert.equal(Fmt.esc(42), '42');
});

test('lapTime formats minutes, seconds and decimals', () => {
  assert.equal(Fmt.lapTime(70.95), '1:10.950');
  assert.equal(Fmt.lapTime(65.5, 1), '1:05.5');
  assert.equal(Fmt.lapTime(59.1234), '59.123');
  assert.equal(Fmt.lapTime(125.004, 2), '2:05.00');
});

test('lapTime shows dashes for invalid times', () => {
  assert.equal(Fmt.lapTime(0), '–:––.–––');
  assert.equal(Fmt.lapTime(-1), '–:––.–––');
  assert.equal(Fmt.lapTime(NaN, 1), '–:––.–');
  assert.equal(Fmt.lapTime(Infinity), '–:––.–––');
  assert.equal(Fmt.lapTime(undefined, 2), '–:––.––');
});

test('duration formats m:ss and h:mm:ss, dash for invalid', () => {
  assert.equal(Fmt.duration(0), '0:00');
  assert.equal(Fmt.duration(65.9), '1:05');
  assert.equal(Fmt.duration(3600 + 2 * 60 + 3), '1:02:03');
  assert.equal(Fmt.duration(-1), '–');
  assert.equal(Fmt.duration(null), '–');
  assert.equal(Fmt.duration(undefined), '–');
  assert.equal(Fmt.duration(NaN), '–');
});

test('signed adds a sign and handles zero / invalid', () => {
  assert.equal(Fmt.signed(1.234), '+1.2');
  assert.equal(Fmt.signed(-0.456, 2), '-0.46');
  assert.equal(Fmt.signed(0), '±0.0');
  assert.equal(Fmt.signed(null), '');
  assert.equal(Fmt.signed(NaN), '');
});

test('gap: laps down, leader, seconds, empty', () => {
  assert.equal(Fmt.gap({ lapsDown: 2, gap: 100 }), '+2L');
  assert.equal(Fmt.gap({ lapsDown: 0, gap: 0 }), 'Leader');
  assert.equal(Fmt.gap({ lapsDown: 0, gap: 3.456 }), '+3.5');
  assert.equal(Fmt.gap({ lapsDown: 0, gap: 3.456 }, 2), '+3.46');
  assert.equal(Fmt.gap({ lapsDown: 0, gap: null }), '');
  assert.equal(Fmt.gap({ lapsDown: 0 }), '');
});

test('driverName in every format', () => {
  const car = { name: 'Max Emilian Verstappen' };
  assert.equal(Fmt.driverName(car, 'full'), 'Max Emilian Verstappen');
  assert.equal(Fmt.driverName(car, undefined), 'Max Emilian Verstappen');
  assert.equal(Fmt.driverName(car, 'short'), 'M. Emilian Verstappen');
  assert.equal(Fmt.driverName(car, 'last'), 'Emilian Verstappen');
  assert.equal(Fmt.driverName(car, 'abbrev'), 'EMI');
  assert.equal(Fmt.driverName({ name: 'Nico Hülkenberg' }, 'abbrev'), 'HÜL');
});

test('driverName with a single-word or empty name', () => {
  assert.equal(Fmt.driverName({ name: 'Senna' }, 'short'), 'Senna');
  assert.equal(Fmt.driverName({ name: 'Senna' }, 'last'), 'Senna');
  assert.equal(Fmt.driverName({ name: 'Senna' }, 'abbrev'), 'SEN');
  assert.equal(Fmt.driverName({ name: '  ' }, 'full'), '');
  assert.equal(Fmt.driverName({}, 'full'), '');
});

test('license badge: class letter, SR with 1 decimal, contrasting text', () => {
  const html = Fmt.license({ license: 'A 3.45', licColor: '#0153db' });
  assert.match(html, /class="lic"/);
  assert.match(html, /background:#0153db;color:#fff/);
  assert.match(html, />A<small>3\.5<\/small>/);
  assert.match(Fmt.license({ license: 'C 2.00', licColor: '#fcee00' }), /color:#000/);
  assert.match(Fmt.license({ license: 'R 1.00' }), /background:#888/);
  assert.equal(Fmt.license({ license: '' }), '');
  assert.equal(Fmt.license({}), '');
});

test('license escapes its text', () => {
  assert.doesNotMatch(Fmt.license({ license: '<b> 1', licColor: '#000000' }), /<b>/);
});

test('irating: k above 1000, plain below, empty for 0', () => {
  assert.equal(Fmt.irating(2450), '2.5k');
  assert.equal(Fmt.irating(1000), '1.0k');
  assert.equal(Fmt.irating(999), '999');
  assert.equal(Fmt.irating(0), '');
  assert.equal(Fmt.irating(undefined), '');
});

test('contrast picks black on light and white on dark', () => {
  assert.equal(Fmt.contrast('#ffffff'), '#000');
  assert.equal(Fmt.contrast('#ffda59'), '#000');
  assert.equal(Fmt.contrast('#000000'), '#fff');
  assert.equal(Fmt.contrast('#0153db'), '#fff');
  assert.equal(Fmt.contrast('ffffff'), '#000');
});

test('rgba converts hex with alpha, tolerates junk', () => {
  assert.equal(Fmt.rgba('#ff8000', 0.5), 'rgba(255,128,0,0.5)');
  assert.equal(Fmt.rgba('0b0f14', 1), 'rgba(11,15,20,1)');
  assert.equal(Fmt.rgba(undefined, 0.3), 'rgba(0,0,0,0.3)');
  assert.equal(Fmt.rgba('#zzzzzz', 1), 'rgba(0,0,0,1)');
});

test('speed and speedUnit in metric and imperial', () => {
  assert.ok(Math.abs(Fmt.speed(10, 'metric') - 36) < 1e-9);
  assert.ok(Math.abs(Fmt.speed(10, 'imperial') - 22.3694) < 1e-9);
  assert.ok(Math.abs(Fmt.speed(10, undefined) - 36) < 1e-9);
  assert.equal(Fmt.speedUnit('metric'), 'km/h');
  assert.equal(Fmt.speedUnit('imperial'), 'mph');
  assert.equal(Fmt.speedUnit(undefined), 'km/h');
});

test('temp in °C (1 decimal) and °F (integer), dash for missing', () => {
  assert.equal(Fmt.temp(24.53, 'metric'), '24.5°C');
  assert.equal(Fmt.temp(100, 'imperial'), '212°F');
  assert.equal(Fmt.temp(0, 'imperial'), '32°F');
  assert.equal(Fmt.temp(null, 'metric'), '–');
  assert.equal(Fmt.temp(undefined, 'imperial'), '–');
});

test('fuel in litres and gallons, with decimals; fuelUnit', () => {
  assert.equal(Fmt.fuel(10, 'metric'), '10.00');
  assert.equal(Fmt.fuel(3.78541, 'imperial'), '1.00');
  assert.equal(Fmt.fuel(12.345, 'metric', 1), '12.3');
  assert.equal(Fmt.fuel(null, 'metric'), '–');
  assert.equal(Fmt.fuel(NaN, 'metric'), '–');
  assert.equal(Fmt.fuelUnit('metric'), 'L');
  assert.equal(Fmt.fuelUnit('imperial'), 'gal');
});

test('TIRES maps compound codes', () => {
  assert.equal(Fmt.TIRES[0], 'D');
  assert.equal(Fmt.TIRES[1], 'W');
});
