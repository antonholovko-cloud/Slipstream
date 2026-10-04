/*
 * Race gaps from our own timing loops. Every car's race progress (laps + lap
 * fraction) is sampled each frame and the session time is recorded as it passes
 * each of BINS points around the lap. The gap from a car ahead to a car behind is
 * then "how long ago the car ahead was where the car behind is now": continuous,
 * exact at any distance, and it counts whole laps for lapped cars.
 *
 * iRacing's CarIdxF2Time only moves when a car crosses a timing line in races, so
 * gaps built from it freeze between lines.
 */

const BINS = 200; // timing points per lap
const KEEP_LAPS = 3; // history kept per car

class GapTracker {
  constructor() { this.reset(); }

  reset() {
    this.cars = new Map(); // idx -> { p, t, bin, cross: Map(bin -> time) }
    this.lastTime = -1;
  }

  /*
   * Race progress for one car, fixing the frame or two where LapCompleted and
   * LapDistPct disagree around the start/finish line. Returns null when the car
   * is not in the world.
   */
  progress(idx, lapCompleted, pct) {
    if (!(pct >= 0) || lapCompleted < 0) return null;
    let p = lapCompleted + pct;
    const prev = this.cars.get(idx);
    if (prev) {
      const d = p - prev.p;
      if (d < -0.5 && d > -1.5 && pct < 0.1) p += 1; // pct wrapped, lap count not yet
      else if (d > 0.5 && d < 1.5 && pct > 0.9) p -= 1; // lap count ahead of pct
    }
    return p;
  }

  update(time, entries) {
    if (time < this.lastTime) this.reset(); // replay rewind / new session
    this.lastTime = time;
    const seen = new Set();
    for (const { idx, p } of entries) {
      if (p === null) continue;
      seen.add(idx);
      const bin = Math.floor(p * BINS);
      let c = this.cars.get(idx);
      if (!c) { this.cars.set(idx, { p, t: time, bin, cross: new Map() }); continue; }
      if (bin > c.bin && bin - c.bin < BINS / 4 && p > c.p) {
        // fill each timing point passed since the last frame, interpolated in time
        for (let b = c.bin + 1; b <= bin; b++) {
          const f = (b / BINS - c.p) / (p - c.p);
          c.cross.set(b, c.t + (time - c.t) * Math.max(0, Math.min(1, f)));
        }
        const oldest = bin - KEEP_LAPS * BINS;
        for (const b of c.cross.keys()) { if (b < oldest) c.cross.delete(b); else break; }
      } else if (Math.abs(bin - c.bin) >= BINS / 4) {
        c.cross.clear(); // teleported (tow, reset): history no longer lines up
      }
      c.p = p; c.t = time; c.bin = bin;
    }
    for (const idx of this.cars.keys()) if (!seen.has(idx)) this.cars.delete(idx);
  }

  // Seconds since the car `front` was at the current position of `back`, or null.
  gap(front, back) {
    const f = this.cars.get(front), b = this.cars.get(back);
    if (!f || !b || f.p < b.p) return null;
    if (f.p - b.p < 1 / BINS) return Math.max(0, (f.p - b.p) * (this.lapTime(f) || 0));
    const x = b.p * BINS, i = Math.floor(x);
    const t0 = f.cross.get(i), t1 = f.cross.get(i + 1);
    if (t0 === undefined) return null;
    const t = t1 === undefined ? t0 : t0 + (t1 - t0) * (x - i);
    return Math.max(0, this.lastTime - t);
  }

  // Seconds `back` needs to reach where `front` is now, at back's own pace: how long it took
  // over that same stretch of track on its previous lap. For the relative: it ignores laps,
  // works across classes (a faster car behind closes at its own speed), and isn't thrown off
  // when the car in front stops (pits, spin) the way "time since front was here" is.
  // Null without a lap of history for that stretch (just joined, after a tow).
  paceGap(front, back) {
    const f = this.cars.get(front), b = this.cars.get(back);
    if (!f || !b) return null;
    const pos = (p) => (((p % 1) + 1) % 1) * BINS;
    let ahead = pos(f.p) - pos(b.p); // bins front is ahead of back on track
    if (ahead < 0) ahead += BINS;
    const lt = this.lapTime(b);
    if (ahead < 1) return lt ? (ahead / BINS) * lt : null;
    const at = (x) => {
      const i = Math.floor(x), t0 = b.cross.get(i), t1 = b.cross.get(i + 1);
      if (t0 === undefined || t1 === undefined) return undefined;
      return t0 + (t1 - t0) * (x - i);
    };
    const start = b.p * BINS - BINS; // back's current spot, one lap ago
    const t0 = at(start), t1 = at(start + ahead);
    if (t0 === undefined || t1 === undefined || !(t1 > t0)) return null;
    return t1 - t0;
  }

  // The car's last full-lap time from its own timing points (for sub-bin gaps).
  lapTime(c) {
    const a = c.cross.get(c.bin), z = c.cross.get(c.bin - BINS);
    return a !== undefined && z !== undefined ? a - z : 0;
  }
}

module.exports = { GapTracker, BINS };
