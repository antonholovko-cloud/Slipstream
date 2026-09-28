/*
 * Sector timing for every car, from LapDistPct crossings of iRacing's sector
 * boundaries (SplitTimeInfo). Crossing times are interpolated between frames.
 * Produces live sectors, personal / session best sectors, optimal lap and a
 * lap log for the player.
 */

const MAX_STEP = 0.05; // max plausible lap fraction per frame; bigger = reset/tow/teleport
const LOG_SIZE = 50;

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
            const entry = {
              lap: v.LapCompleted, time, sectors: st.times.slice(0, n), off: st.off, pit: st.pit,
              fuel: st.fuelStart !== null && v.FuelLevel !== undefined ? st.fuelStart - v.FuelLevel : null, at: t, official: false,
            };
            this.log.push(entry);
            if (this.log.length > LOG_SIZE) this.log.shift();
            if (!entry.off && !entry.pit && !(this.bestLap <= time)) this.bestLap = time;
          }
          st.times = [];
          st.lapStart = tc;
          st.off = false;
          st.pit = !!(v.CarIdxOnPitRoad && v.CarIdxOnPitRoad[i]);
          if (isPlayer) st.fuelStart = v.FuelLevel ?? null;
        }
        st.secStart = tc;
        st.sector = k;
        st.dirty = !!(v.CarIdxOnPitRoad && v.CarIdxOnPitRoad[i]);
      }
      st.pct = pct;
      st.t = t;
    }

    // Prefer iRacing's own lap time when it reports the lap we just logged.
    const official = v.LapLastLapTime;
    if (official > 0 && official !== this.lastOfficial) {
      this.lastOfficial = official;
      const last = this.log[this.log.length - 1];
      if (last && !last.official && t - last.at < 5 && Math.abs(last.time - official) < 0.3) {
        last.time = official;
        last.official = true;
        if (!last.off && !last.pit) this.bestLap = Math.min(...this.log.filter((e) => !e.off && !e.pit).map((e) => e.time));
      }
    }
    return this.state(t, playerIdx, classOf(playerIdx));
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
