/*
 * League class splits: re-group the cars of one iRacing class into custom sub-classes,
 * e.g. GT3 -> "GT3 Pro" / "GT3 Am". iRacing only knows the car class, so leagues split
 * by car number range, by a list of drivers, or by iRating. Rules are checked in order,
 * the first matching rule wins, and a car that matches none keeps its iRacing class.
 *
 * Rule: { id, on, name, color, from, league, match, numbers, drivers, irMin, irMax }
 *   from   iRacing class short name (or class id) to split, '' = any class
 *   league iRacing league id the rule is limited to, '' = any session
 *   match  'numbers' | 'drivers' | 'irating' | 'rest' (every remaining car of the class)
 */

// "1-49, 77, 100-199" -> [[1,49],[77,77],[100,199]]
function parseNumbers(str) {
  const out = [];
  for (const part of String(str || '').split(/[,;\s]+/)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] !== undefined ? +m[2] : a;
    out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

// Names or iRacing customer ids, one per line or comma separated.
function parseList(str) {
  return new Set(String(str || '').split(/[\n,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function baseMatches(rule, d) {
  const from = String(rule.from || '').trim().toLowerCase();
  return !from || from === String(d.className).toLowerCase() || from === String(d.classId);
}

function carMatches(rule, d, cache) {
  switch (rule.match) {
    case 'numbers': {
      const n = parseInt(d.number, 10);
      return Number.isFinite(n) && cache.numbers.some(([a, b]) => n >= a && n <= b);
    }
    case 'drivers':
      return cache.drivers.has(String(d.name).toLowerCase()) || cache.drivers.has(String(d.userId)) || (!!d.team && cache.drivers.has(String(d.team).toLowerCase()));
    case 'irating': {
      const lo = Number.isFinite(+rule.irMin) && rule.irMin !== '' && rule.irMin !== null ? +rule.irMin : -Infinity;
      const hi = Number.isFinite(+rule.irMax) && rule.irMax !== '' && rule.irMax !== null ? +rule.irMax : Infinity;
      return d.irating >= lo && d.irating < hi;
    }
    case 'rest': return true;
    default: return false;
  }
}

// drivers: [{ idx, name, team, number, userId, irating, classId, className, classColor }] (their iRacing class)
// Returns Map idx -> { id, name, color, order } for the cars that move to a sub-class.
function assignSplits(drivers, rules, leagueId) {
  const out = new Map();
  const active = (Array.isArray(rules) ? rules : []).map((r, order) => ({ r, order }))
    .filter(({ r }) => r && r.on !== false && String(r.name || '').trim())
    .filter(({ r }) => !String(r.league ?? '').trim() || String(r.league).trim() === String(leagueId));
  if (!active.length) return out;
  for (const a of active) a.cache = { numbers: parseNumbers(a.r.numbers), drivers: parseList(a.r.drivers) };
  for (const d of drivers) {
    for (const { r, order, cache } of active) {
      if (!baseMatches(r, d) || !carMatches(r, d, cache)) continue;
      const name = String(r.name).trim();
      out.set(d.idx, { id: `split:${d.classId}:${name.toLowerCase()}`, name, color: r.color || d.classColor, order: order + 1 });
      break;
    }
  }
  return out;
}

module.exports = { assignSplits, parseNumbers, parseList };
