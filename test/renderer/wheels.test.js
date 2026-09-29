const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'lib', 'wheels.js'), 'utf8'));
const Wheels = dom.window.Wheels;

function parse(svg) {
  const div = dom.window.document.createElement('div');
  div.innerHTML = svg;
  return div.firstElementChild;
}

test('lists every wheel style', () => {
  assert.deepEqual([...Wheels.styles], ['gt', 'rs50', 'round', 'formula', 'ring', 'bar']);
});

for (const style of ['gt', 'rs50', 'round', 'formula', 'ring']) {
  test(`${style}: a centred 100x100 SVG with one rotating group`, () => {
    const el = parse(Wheels.svg(style));
    assert.equal(el.tagName.toLowerCase(), 'svg');
    assert.equal(el.getAttribute('viewBox'), '-50 -50 100 100');
    assert.equal(el.querySelectorAll('g.rot').length, 1);
    assert.ok(el.querySelector('g.rot').children.length > 0);
    assert.ok(el.querySelector('defs'));
  });
}

test('styles draw different artwork', () => {
  const bodies = ['gt', 'rs50', 'round', 'formula', 'ring'].map((s) => parse(Wheels.svg(s)).querySelector('g.rot').innerHTML);
  assert.equal(new Set(bodies).size, bodies.length);
});

test('bar: a horizontal steering bar with fill and knob, no rotating group', () => {
  const el = parse(Wheels.svg('bar'));
  assert.equal(el.getAttribute('viewBox'), '-50 -12 100 24');
  assert.ok(el.classList.contains('steerbar'));
  assert.ok(el.querySelector('.fill'));
  assert.ok(el.querySelector('.knob'));
  assert.equal(el.querySelector('g.rot'), null);
});

test('unknown style falls back to the simple wheel', () => {
  assert.equal(Wheels.svg('nope'), Wheels.svg('gt'));
  assert.equal(Wheels.svg(undefined), Wheels.svg('gt'));
});
