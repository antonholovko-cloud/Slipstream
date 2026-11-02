/*
 * Lap statistics: every session the player drives, with track, car, date, session type,
 * conditions and each lap (from the timing tracker's lap log), kept in lap-stats.json next to
 * the settings file. Fastest and average lap are worked out from the laps, so the rules can
 * change without losing data: both count only clean laps (no off-track, no pit lane).
 */
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const MAX_SESSIONS = 2000;

// Fastest and average of the clean laps; null while there are none.
function summarize(rec) {
  const clean = rec.laps.filter((l) => !l.off && !l.pit && l.time > 0).map((l) => l.time);
  const fastest = clean.length ? Math.min(...clean) : null;
  const avg = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
  const temps = (k) => rec.laps.map((l) => l[k]).filter(Number.isFinite);
  const air = temps('air'), trk = temps('trk');
  return {
    laps: rec.laps.length, clean: clean.length, fastest, avg,
    air: air.length ? [Math.min(...air), Math.max(...air)] : null,
    trk: trk.length ? [Math.min(...trk), Math.max(...trk)] : null,
  };
}

class LapStats {
  constructor(file) {
    this.file = file;
    this.data = this.load();
    this.cur = null; // { model, key, rec, byAt }
    this.saveTimer = null;
    this.onChange = null;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.sessions)) return { version: VERSION, sessions: raw.sessions };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Lap stats load failed:', e.message);
    }
    return { version: VERSION, sessions: [] };
  }

  /*
   * Called with every model state from iRacing (not demo data, not replays). A session starts
   * a new record when the model is new (reconnect) or its session key changes; the record is
   * only kept once a lap is logged. Laps are matched by their session time, so iRacing's
   * official lap time, arriving a moment later, updates the lap already stored.
   */
  update(model, st, now = Date.now()) {
    if (!st || !st.session || !st.timing || st.session.replay) return;
    const key = `${model.sessionKey}|${st.session.car.id}`;
    if (!this.cur || this.cur.model !== model || this.cur.key !== key) {
      const s = st.session;
      this.cur = {
        model, key, byAt: new Map(),
        rec: {
          id: now.toString(36) + Math.random().toString(36).slice(2, 6),
          date: now,
          track: { id: s.track.id, name: s.track.name, config: s.track.config },
          car: { id: s.car.id, name: s.car.name },
          type: s.type, name: s.name, kind: s.kind,
          conditions: { air: s.airTemp, trk: s.trackTemp, wetness: s.wetness, skies: s.skies },
          laps: [],
        },
      };
    }
    const { rec, byAt } = this.cur;
    let changed = false;
    for (const e of st.timing.log) {
      const lap = byAt.get(e.at);
      if (!lap) {
        const l = { lap: e.lap, time: e.time, off: !!e.off, pit: !!e.pit, air: st.session.airTemp, trk: st.session.trackTemp };
        byAt.set(e.at, l);
        rec.laps.push(l);
        if (rec.laps.length === 1) this.data.sessions.push(rec);
        changed = true;
      } else if (lap.time !== e.time || lap.lap !== e.lap) {
        lap.time = e.time;
        lap.lap = e.lap;
        changed = true;
      }
    }
    if (changed) {
      if (this.data.sessions.length > MAX_SESSIONS) this.data.sessions.splice(0, this.data.sessions.length - MAX_SESSIONS);
      this.save();
      if (this.onChange) this.onChange();
    }
  }

  // Newest first, each with its summary.
  list() {
    return this.data.sessions.slice().reverse().map((r) => ({ ...r, summary: summarize(r) }));
  }

  remove(id) {
    if (id === '*') this.data.sessions = [];
    else this.data.sessions = this.data.sessions.filter((r) => r.id !== id);
    if (this.cur && !this.data.sessions.includes(this.cur.rec)) this.cur = null;
    this.save();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 2000);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('Lap stats save failed:', e.message);
    }
  }
}

module.exports = { LapStats, summarize };
