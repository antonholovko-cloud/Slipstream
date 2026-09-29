/*
 * Sector timing for every car, from LapDistPct crossings of iRacing's sector
 * boundaries (SplitTimeInfo). Crossing times are interpolated between frames.
 * Produces live sectors, personal / session best sectors, optimal lap and a
 * lap log for the player.
 */

const MAX_STEP = 0.05; // max plausible lap fraction per frame; bigger = reset/tow/teleport
const LOG_SIZE = 50;
const TRACE_BINS = 1000; // lap trace resolution for our own delta

// Fill unvisited bins of a lap trace by linear interpolation.
function fillTrace(tr, lapTime) {
  const n = tr.length;
  const out = Float64Array.from(tr);
  out[0] = out[0] >= 0 ? out[0] : 0;
  let prev = 0;
  for (let i = 1; i <= n; i++) {
    const v = i === n ? lapTime : out[i];
    if (v >= 0) {
      for (let j = prev + 1; j < i; j++) out[j] = out[prev] + ((v - out[prev]) * (j - prev)) / (i - prev);
      prev = i;
    }
  }
  return out;
}

function traceAt(tr, lapTime, pct) {
  const f = Math.max(0, Math.min(0.999999, pct)) * tr.length;
  const i = Math.floor(f);
  const a = tr[i], b = i + 1 < tr.length ? tr[i + 1] : lapTime;
  return a + (b - a) * (f - i);
}

class TimingTracker {
  constructor() {
    this.starts = [0, 1 / 3, 2 / 3];
    this.reset();
  }

  reset() {
    this.cars = new Map();
    this.sessionBest = new Map(); // classId -> best sector times
    this.personalBest = [];
    this.bestLap = null;
    this.log = [];
    this.lastOfficial = null;
    this.trace = null; // player's current lap: elapsed time at each bin
    this.bestTrace = null; // { tr, time }
    this.lastTrace = null;
    this.deltaHist = [];
  }

  setSectors(info) {
    const list = ((info || {}).SplitTimeInfo || {}).Sectors || [];
    let starts = list.map((s) => Number(s.SectorStartPct)).filter((x) => x >= 0 && x < 1).sort((a, b) => a - b);
    if (!starts.length || starts[0] !== 0) starts = [0, ...starts.filter((x) => x > 0)];
    if (starts.length < 2) starts = [0, 1 / 3, 2 / 3];
    if (starts.join() !== this.starts.join()) {
      this.starts = starts;
      this.reset();
    }
  }

  sectorOf(pct) {
    let k = 0;
    for (let i = 0; i < this.starts.length; i++) if (pct >= this.starts[i]) k = i;
    return k;
  }

  // classOf(idx) -> class id, so session bests compare cars of the same class
  update(v, playerIdx, classOf = () => 0) {
    const t = v.SessionTime;
    const pcts = v.CarIdxLapDistPct || [];
    const n = this.starts.length;
    for (let i = 0; i < pcts.length; i++) {
      const pct = pcts[i];
      if (!(pct >= 0)) { this.cars.delete(i); continue; }
      const isPlayer = i === playerIdx;
      let st = this.cars.get(i);
      if (!st) {
        st = { pct, t, sector: this.sectorOf(pct), secStart: null, lapStart: null, times: [], dirty: false, off: false, pit: false, fuelStart: null };
        this.cars.set(i, st);
        continue;
      }
      if (v.CarIdxOnPitRoad && v.CarIdxOnPitRoad[i]) { st.pit = true; st.dirty = true; }
      const surf = isPlayer ? v.PlayerTrackSurface : v.CarIdxTrackSurface && v.CarIdxTrackSurface[i];
      if (surf === 0) st.off = true;

      let d = pct - st.pct;
      if (d < -0.5) d += 1;
      if (d < 0 || d > MAX_STEP || !(t > st.t)) {
        // went backwards, towed or reset: the current lap can't be timed
        if (d < -0.001 || d > MAX_STEP) { st.secStart = null; st.lapStart = null; st.times = []; }
        st.pct = pct; st.t = t;
        continue;
      }
      if (d === 0) { st.t = t; continue; }

      // boundary crossings between st.pct and st.pct + d (b + 1 handles the wrap at S/F)
      const crossings = [];
      for (let k = 0; k < n; k++) {
        for (const b of [this.starts[k], this.starts[k] + 1]) {
          if (st.pct < b && b <= st.pct + d) crossings.push({ k, tc: st.t + ((b - st.pct) / d) * (t - st.t), b });
        }
      }
      crossings.sort((a, b) => a.b - b.b);
      for (const { k, tc } of crossings) {
        if (st.secStart !== null) {
          const prev = (k - 1 + n) % n;
          const dur = tc - st.secStart;
          st.times[prev] = dur;
          if (!st.dirty && dur > 0) {
            const cls = classOf(i);
            if (!this.sessionBest.has(cls)) this.sessionBest.set(cls, []);
            const sbc = this.sessionBest.get(cls);
            if (!(sbc[prev] <= dur)) sbc[prev] = dur;
            if (isPlayer && !st.off && !(this.personalBest[prev] <= dur)) this.personalBest[prev] = dur;
          }
        }
        if (k === 0) {
          if (isPlayer && st.lapStart !== null && st.times.filter((x) => x > 0).length === n) {
            const time = tc - st.lapStart;
            const prevLap = this.log.length ? this.log[this.log.length - 1].lap : 0;
            const entry = {
              lap: Math.max(v.LapCompleted ?? 0, prevLap + 1), time, sectors: st.times.slice(0, n), off: st.off, pit: st.pit,
              fuel: st.fuelStart !== null && v.FuelLevel !== undefined ? st.fuelStart - v.FuelLevel : null, at: t, official: false,
            };
            this.log.push(entry);
            if (this.log.length > LOG_SIZE) this.log.shift();
            if (this.trace) {
              const tr = { tr: fillTrace(this.trace, time), time };
              this.lastTrace = tr;
              if (!entry.off && !entry.pit && (this.bestLap === null || time < this.bestLap)) this.bestTrace = tr;
            }
            if (!entry.off && !entry.pit && (this.bestLap === null || time < this.bestLap)) this.bestLap = time;
          }
          st.times = [];
          st.lapStart = tc;
          st.off = false;
          st.pit = !!(v.CarIdxOnPitRoad && v.CarIdxOnPitRoad[i]);
          if (isPlayer) { st.fuelStart = v.FuelLevel ?? null; this.trace = new Float64Array(TRACE_BINS).fill(-1); }
        }
        st.secStart = tc;
        st.sector = k;
        st.dirty = !!(v.CarIdxOnPitRoad && v.CarIdxOnPitRoad[i]);
      }
      st.pct = pct;
      st.t = t;
      if (isPlayer && this.trace && st.lapStart !== null) {
        const bin = Math.min(TRACE_BINS - 1, Math.floor(pct * TRACE_BINS));
        if (this.trace[bin] < 0) this.trace[bin] = t - st.lapStart;
      }
      if (isPlayer && st.lapStart === null) this.trace = null;
    }

    // Prefer iRacing's own lap time when it reports the lap we just logged.
    const official = v.LapLastLapTime;
    if (official > 0 && official !== this.lastOfficial) {
      this.lastOfficial = official;
      const last = this.log[this.log.length - 1];
      if (last && !last.official && t - last.at < 5 && Math.abs(last.time - official) < 0.3) {
        last.time = official;
        last.official = true;
        if (v.LapCompleted > 0) last.lap = v.LapCompleted; // by now iRacing has counted the lap
        if (!last.off && !last.pit) this.bestLap = Math.min(...this.log.filter((e) => !e.off && !e.pit).map((e) => e.time));
      }
    }
    return this.state(t, playerIdx, classOf(playerIdx));
  }

  // Our own live delta vs a recorded lap: [delta, rate, ok] like iRacing's LapDeltaTo* vars.
  delta(which, t, playerIdx) {
    const ref = which === 'last' ? this.lastTrace : this.bestTrace;
    const st = this.cars.get(playerIdx);
    if (!ref || !st || st.lapStart === null) return [0, 0, false];
    const d = t - st.lapStart - traceAt(ref.tr, ref.time, st.pct);
    const hist = this.deltaHist;
    hist.push([t, d, which]);
    while (hist.length && t - hist[0][0] > 0.5) hist.shift();
    const old = hist.find((h) => h[2] === which);
    const rate = old && t - old[0] > 0.1 ? (d - old[1]) / (t - old[0]) : 0;
    return [d, rate, true];
  }

  state(t, playerIdx, playerClass) {
    const n = this.starts.length;
    const st = this.cars.get(playerIdx);
    const pb = this.personalBest;
    const optimal = pb.length === n && pb.every((x) => x > 0) ? pb.reduce((a, b) => a + b, 0) : null;
    return {
      starts: this.starts,
      current: st ? {
        sector: st.sector,
        times: st.times.slice(0, n),
        running: st.secStart !== null ? t - st.secStart : null,
        lapRunning: st.lapStart !== null ? t - st.lapStart : null,
        timed: st.lapStart !== null,
      } : null,
      personalBest: pb.slice(0, n),
      sessionBest: (this.sessionBest.get(playerClass) || []).slice(0, n),
      bestLap: this.bestLap,
      optimal,
      log: this.log.slice(-30),
    };
  }
}

module.exports = { TimingTracker };
