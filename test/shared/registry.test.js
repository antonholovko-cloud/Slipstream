const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Registry = require('../../src/shared/registry');

const { OVERLAYS, COMMON_SCHEMA, THEMES, FONTS, defaultSettingsFor, byId } = Registry;
const FIELD_TYPES = new Set(['bool', 'number', 'range', 'select', 'color', 'text', 'columns']);
const WIDGETS = path.join(__dirname, '..', '..', 'src', 'renderer', 'widgets');
// state slices RaceModel.update() returns (plus what main.js adds)
const STATE_KEYS = new Set(['connected', 'session', 'player', 'cars', 'classes', 'relative', 'radar', 'fuel', 'trackMap', 'timing']);

test('every overlay has an id, name, icon, description, bounds, needs and schema', () => {
  assert.ok(OVERLAYS.length > 0);
  for (const o of OVERLAYS) {
    assert.match(o.id, /^[a-z]+$/, 'id ' + o.id);
    assert.ok(o.name && typeof o.name === 'string', o.id + ' name');
    assert.ok(o.icon, o.id + ' icon');
    assert.ok(o.description, o.id + ' description');
    for (const k of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(o.bounds[k]), `${o.id} bounds.${k}`);
    assert.ok(o.bounds.width >= 60 && o.bounds.height >= 30, o.id + ' bounds big enough');
    assert.ok(Array.isArray(o.needs) && o.needs.length, o.id + ' needs');
    for (const n of o.needs) assert.ok(STATE_KEYS.has(n), `${o.id} needs unknown state "${n}"`);
    assert.ok(Array.isArray(o.schema), o.id + ' schema');
  }
});

test('overlay ids are unique and each has a widget file', () => {
  const ids = OVERLAYS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(fs.existsSync(path.join(WIDGETS, id + '.js')), 'widget file for ' + id);
  const html = fs.readFileSync(path.join(WIDGETS, '..', 'overlay.html'), 'utf8');
  for (const id of ids) assert.ok(html.includes(`widgets/${id}.js`), 'overlay.html loads ' + id);
});

function checkField(where, f) {
  assert.ok(f.key && typeof f.key === 'string', where + ' key');
  assert.ok(f.label, `${where}.${f.key} label`);
  assert.ok(FIELD_TYPES.has(f.type), `${where}.${f.key} type ${f.type}`);
  const at = `${where}.${f.key}`;
  switch (f.type) {
    case 'bool': assert.equal(typeof f.default, 'boolean', at); break;
    case 'number':
    case 'range':
      assert.equal(typeof f.default, 'number', at);
      if (f.min !== undefined) assert.ok(f.default >= f.min, `${at} default ${f.default} >= min ${f.min}`);
      if (f.max !== undefined) assert.ok(f.default <= f.max, `${at} default ${f.default} <= max ${f.max}`);
      if (f.type === 'range') assert.ok(f.min < f.max, at + ' range min < max');
      break;
    case 'select':
      assert.ok(Array.isArray(f.options) && f.options.length >= 2, at + ' options');
      assert.ok(f.options.some((o) => o.value === f.default), `${at} default "${f.default}" is an option`);
      assert.equal(new Set(f.options.map((o) => o.value)).size, f.options.length, at + ' unique option values');
      break;
    case 'color':
      if (f.default !== '' || !f.allowEmpty) assert.match(f.default, /^#[0-9a-f]{6}$/i, at);
      break;
    case 'columns': {
      assert.ok(Array.isArray(f.columns) && f.columns.length, at + ' columns');
      const ids = f.columns.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length, at + ' unique column ids');
      for (const c of f.columns) { assert.ok(c.label, `${at}.${c.id} label`); assert.equal(typeof c.default, 'boolean', `${at}.${c.id} default`); }
      break;
    }
    default: break;
  }
}

test('common schema fields are well formed', () => {
  for (const f of COMMON_SCHEMA) checkField('common', f);
});

test('every overlay schema field is well formed, with keys unique per overlay', () => {
  for (const o of OVERLAYS) {
    const keys = o.schema.map((f) => f.key).concat(COMMON_SCHEMA.map((f) => f.key));
    assert.equal(new Set(keys).size, keys.length, o.id + ' keys unique (and not clashing with common keys)');
    for (const f of o.schema) checkField(o.id, f);
  }
});

test('defaultSettingsFor: schema defaults, overlay defaults on top, enabled and a copy of bounds', () => {
  for (const o of OVERLAYS) {
    const s = defaultSettingsFor(o);
    assert.equal(typeof s.enabled, 'boolean');
    assert.deepEqual(s.bounds, o.bounds);
    assert.notEqual(s.bounds, o.bounds, 'bounds is a copy');
    for (const f of COMMON_SCHEMA.concat(o.schema)) {
      if (o.defaults && f.key in o.defaults) assert.deepEqual(s[f.key], o.defaults[f.key], `${o.id}.${f.key} overlay default`);
      else if (f.type === 'columns') assert.deepEqual(s[f.key], f.columns.map((c) => ({ id: c.id, on: c.default })));
      else assert.deepEqual(s[f.key], f.default, `${o.id}.${f.key}`);
    }
  }
  // two calls never share objects
  const a = defaultSettingsFor(byId('relative')), b = defaultSettingsFor(byId('relative'));
  a.columns[0].on = !a.columns[0].on;
  a.bounds.x = -1;
  assert.notEqual(a.columns[0].on, b.columns[0].on);
  assert.notEqual(b.bounds.x, -1);
});

test('overlay-level defaults are within their schema limits', () => {
  for (const o of OVERLAYS) {
    for (const [k, v] of Object.entries(o.defaults || {})) {
      const f = COMMON_SCHEMA.concat(o.schema).find((x) => x.key === k);
      if (!f) continue; // migration flags like layoutV2
      if (f.min !== undefined) assert.ok(v >= f.min, `${o.id}.${k}`);
      if (f.max !== undefined) assert.ok(v <= f.max, `${o.id}.${k}`);
    }
  }
});

test('flags are off by default, everything else on', () => {
  assert.equal(defaultSettingsFor(byId('flags')).enabled, false);
  for (const o of OVERLAYS) if (o.id !== 'flags') assert.equal(defaultSettingsFor(o).enabled, true, o.id);
});

test('every theme has all the colors the overlay host uses', () => {
  const keys = ['bg', 'bgAlt', 'header', 'text', 'dim', 'accent', 'player', 'purple', 'green', 'red', 'yellow', 'blue', 'border'];
  assert.ok(THEMES.carbon, 'carbon is the fallback theme');
  for (const [id, t] of Object.entries(THEMES)) {
    assert.ok(t.name, id + ' name');
    for (const k of keys) assert.match(t[k], /^#[0-9a-f]{6}$/i, `${id}.${k}`);
    assert.ok(t.font && typeof t.font === 'string', id + ' font');
    assert.ok(Number.isFinite(t.radius) && t.radius >= 0, id + ' radius');
    assert.ok(FONTS.includes(t.font), `${id} font ${t.font} is in FONTS`);
  }
});

test('byId finds overlays and returns undefined for unknown ids', () => {
  for (const o of OVERLAYS) assert.equal(byId(o.id), o);
  assert.equal(byId('radar'), undefined);
  assert.equal(byId(''), undefined);
});

test('relative has the class tag column right after the car number, and class grouping on', () => {
  const rel = byId('relative');
  const cols = rel.schema.find((f) => f.key === 'columns').columns.map((c) => c.id);
  assert.equal(cols[cols.indexOf('number') + 1], 'class');
  assert.equal(defaultSettingsFor(rel).groupByClass, true);
});
