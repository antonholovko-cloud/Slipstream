const test = require('node:test');
const assert = require('node:assert/strict');
const { assignSplits, parseNumbers, parseList } = require('../../src/main/classes');

const d = (idx, over = {}) => ({ idx, name: `Driver ${idx}`, team: '', number: String(idx), userId: 1000 + idx, irating: 1500, classId: 1, className: 'GT3', classColor: '#ffda59', ...over });
const field = [d(1), d(7), d(50), d(99), d(100, { irating: 3000 }), d(150, { irating: 900 }), d(2, { classId: 2, className: 'LMP2', classColor: '#33ceff' })];

test('parseNumbers: ranges, single numbers, reversed ranges, junk ignored', () => {
  assert.deepEqual(parseNumbers('1-49, 77 100-199;5'), [[1, 49], [77, 77], [100, 199], [5, 5]]);
  assert.deepEqual(parseNumbers('20-10'), [[10, 20]]);
  assert.deepEqual(parseNumbers('abc, 3x, -4, '), []);
  assert.deepEqual(parseNumbers(undefined), []);
});

test('parseList: lines / commas / semicolons, trimmed and lowercased', () => {
  assert.deepEqual([...parseList(' Max Verstappen \n123456, Team X;;')], ['max verstappen', '123456', 'team x']);
  assert.equal(parseList('').size, 0);
  assert.equal(parseList(null).size, 0);
});

test('no rules / empty list: nothing moves', () => {
  assert.equal(assignSplits(field, [], 0).size, 0);
  assert.equal(assignSplits(field, undefined, 0).size, 0);
  assert.equal(assignSplits(field, 'nope', 0).size, 0);
});

test('car number ranges pick the right cars, only in the matching base class', () => {
  const out = assignSplits(field, [{ name: 'GT3 Am', from: 'gt3', match: 'numbers', numbers: '1-99' }], 0);
  assert.deepEqual([...out.keys()].sort((a, b) => a - b), [1, 7, 50, 99]);
  const sp = out.get(7);
  assert.equal(sp.name, 'GT3 Am');
  assert.equal(sp.id, 'split:1:gt3 am');
  assert.equal(sp.color, '#ffda59', 'no rule color falls back to the base class color');
  assert.equal(sp.order, 1);
  assert.ok(!out.has(2), 'LMP2 #2 is not in GT3');
});

test('base class can be given by class id, and empty = any class', () => {
  assert.ok(assignSplits(field, [{ name: 'X', from: '2', match: 'numbers', numbers: '2' }], 0).has(2));
  const any = assignSplits(field, [{ name: 'Low', match: 'numbers', numbers: '1-2' }], 0);
  assert.deepEqual([...any.keys()].sort(), [1, 2]);
  assert.notEqual(any.get(1).id, any.get(2).id, 'same name in two base classes stays two classes');
});

test('non-numeric car numbers never match a number rule', () => {
  const out = assignSplits([d(1, { number: 'X' })], [{ name: 'A', match: 'numbers', numbers: '0-999' }], 0);
  assert.equal(out.size, 0);
});

test('driver list matches name (case-insensitive), customer id, or team name', () => {
  const cars = [d(1, { name: 'Max Verstappen' }), d(2, { userId: 424242 }), d(3, { team: 'Red Bull Am' }), d(4)];
  const out = assignSplits(cars, [{ name: 'Am', match: 'drivers', drivers: 'max verstappen\n424242\nRED BULL AM' }], 0);
  assert.deepEqual([...out.keys()].sort(), [1, 2, 3]);
});

test('empty team name is never matched by an empty list entry', () => {
  const out = assignSplits([d(1, { team: '' })], [{ name: 'Am', match: 'drivers', drivers: '\n,\n' }], 0);
  assert.equal(out.size, 0);
});

test('iRating range: min inclusive, max exclusive, blanks = open ends', () => {
  const rule = (irMin, irMax) => [{ name: 'S', from: 'GT3', match: 'irating', irMin, irMax }];
  const keys = (r) => [...assignSplits(field, r, 0).keys()].sort((a, b) => a - b);
  assert.deepEqual(keys(rule('', '1500')), [150]);
  assert.deepEqual(keys(rule('1500', '3000')), [1, 7, 50, 99]);
  assert.deepEqual(keys(rule('3000', '')), [100]);
  assert.deepEqual(keys(rule(null, null)), [1, 7, 50, 99, 100, 150]);
});

test('first matching rule wins and "rest" catches the remaining cars of the class', () => {
  const rules = [
    { name: 'Pro', color: '#f00', from: 'GT3', match: 'numbers', numbers: '1-49' },
    { name: 'Am', color: '#00f', from: 'GT3', match: 'rest' },
  ];
  const out = assignSplits(field, rules, 0);
  assert.equal(out.get(1).name, 'Pro');
  assert.equal(out.get(7).name, 'Pro');
  assert.equal(out.get(50).name, 'Am');
  assert.equal(out.get(150).name, 'Am');
  assert.equal(out.get(1).order, 1);
  assert.equal(out.get(50).order, 2);
  assert.equal(out.get(1).color, '#f00');
  assert.ok(!out.has(2), 'rest only covers the rule\'s base class');
});

test('disabled rules, nameless rules and unknown match types are ignored', () => {
  const rules = [
    { on: false, name: 'Off', match: 'rest' },
    { name: '   ', match: 'rest' },
    { name: 'Weird', match: 'bogus' },
    null,
    { name: 'On', from: 'LMP2', match: 'rest' },
  ];
  const out = assignSplits(field, rules, 0);
  assert.deepEqual([...out.keys()], [2]);
  assert.equal(out.get(2).name, 'On');
  assert.equal(out.get(2).order, 5, 'order is the position in the full rule list');
});

test('league id filter: blank = every session, otherwise only that league', () => {
  const rules = [{ name: 'Am', from: 'GT3', match: 'rest', league: ' 1234 ' }];
  assert.equal(assignSplits(field, rules, 1234).size, 6);
  assert.equal(assignSplits(field, rules, '1234').size, 6);
  assert.equal(assignSplits(field, rules, 999).size, 0);
  assert.equal(assignSplits(field, [{ name: 'Am', from: 'GT3', match: 'rest', league: '' }], 999).size, 6);
});

test('sub-class name is trimmed and the id is stable per base class + name', () => {
  const out = assignSplits([d(1)], [{ name: '  GT3 Am  ', match: 'rest' }], 0);
  assert.equal(out.get(1).name, 'GT3 Am');
  assert.equal(out.get(1).id, 'split:1:gt3 am');
});
