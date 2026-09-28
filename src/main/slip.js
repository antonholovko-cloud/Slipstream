/*
 * Wheelspin / lockup estimate. iRacing's live telemetry has no wheel speeds, so
 * we learn the engine-RPM : road-speed ratio for each gear while driving
 * normally, then report how far the current ratio deviates from it:
 *   dev > 0  -> engine turning faster than road speed allows (driven wheels spinning)
 *   dev < 0  -> engine dragged below it (driven wheels locking)
 * Front lockups on rear-drive cars are invisible to this; ABS activity covers ABS cars.
 */

const SAMPLES = 200;

class SlipEstimator {
  constructor() {
    this.reset();
  }

  reset() {
    this.gears = new Map(); // gear -> { samples: [], ratio }
    this.lastGear = null;
    this.gearChangedAt = -1;
  }

  update(v) {
    const t = v.SessionTime ?? 0;
    const gear = v.Gear ?? 0;
    const speed = v.Speed ?? 0;
    const rpm = v.RPM ?? 0;
    const clutchEngaged = (v.Clutch ?? 1) > 0.9;
    if (gear !== this.lastGear) { this.lastGear = gear; this.gearChangedAt = t; }
    const settled = t - this.gearChangedAt > 0.4;
    const out = { dev: 0, learned: false, abs: !!v.BrakeABSactive };
    if (gear <= 0 || speed < 6 || !clutchEngaged || !settled || rpm < 500) return out;

    const ratio = rpm / speed;
    let g = this.gears.get(gear);
    if (!g) { g = { samples: [], ratio: 0 }; this.gears.set(gear, g); }

    // learn while driving (on throttle, off the brake); the median ignores short spin events
    const calm = (v.Brake ?? 0) < 0.02 && (v.Throttle ?? 0) > 0.05;
    if (calm) {
      g.samples.push(ratio);
      if (g.samples.length > SAMPLES) g.samples.shift();
      if (g.samples.length >= 30 && g.samples.length % 10 === 0) {
        const sorted = g.samples.slice().sort((a, b) => a - b);
        g.ratio = sorted[Math.floor(sorted.length / 2)];
      }
    }
    if (g.ratio > 0) {
      out.dev = ratio / g.ratio - 1;
      out.learned = true;
    }
    return out;
  }
}

module.exports = { SlipEstimator };
