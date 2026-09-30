/*
 * RaceModel turns raw telemetry frames into a derived, overlay-friendly state:
 * standings, relative gaps, fuel stats, radar, learned track map, iRating deltas.
 */

const { TimingTracker } = require('./timing');
const { SlipEstimator } = require('./slip');
const { GapTracker } = require('./gaps');
const { assignSplits } = require('./classes');

const TRACK_BINS = 500;

function num(v, d = 0) {
  if (typeof v === 'number') return v;
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : d;
}

function hexColor(c, fallback = '#ffffff') {
  if (c === undefined || c === null || c === '') return fallback;
  const n = typeof c === 'number' ? c : parseInt(String(c).replace(/^#/, '0x'), 16);
  if (!Number.isFinite(n)) return fallback;
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

function sessionKind(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('race')) return 'race';
  if (t.includes('qual')) return 'qualify';
  return 'practice';
}

// Community reverse-engineered iRacing iRating formula (estimate).
function iratingDeltas(entries) {
  const br = 1600 / Math.LN2;
  const n = entries.length;
  if (n < 2) return entries.map(() => 0);
  const ex = entries.map((e) => Math.exp(-e.ir / br));
  const chance = (a, b) => ((1 - ex[a]) * ex[b]) / ((1 - ex[b]) * ex[a] + (1 - ex[a]) * ex[b]);
  return entries.map((e, i) => {
    let expected = -0.5;
    for (let j = 0; j < n; j++) expected += chance(i, j);
    const fudge = (n / 2 - e.pos) / 100;
    return Math.round(((n - e.pos - expected - fudge) * 200) / n);
  });
}

class RaceModel {
  constructor(opts) {
    this.opts = opts || {};
    this.trackMaps = this.opts.trackMaps || {};
    this.onTrackLearned = this.opts.onTrackLearned || (() => {});
    this.reset();
  }

  reset() {
    this.siu = -1;
    this.drivers = new Map();
    this.info = null;
    this.sessionNum = -1;
    this.perCar = new Map(); // idx -> {pitStops, wasPit, startPos, lastPitLap}
    this.fuelLaps = []; // fuel used per lap
    this.fuelLapStart = null;
    this.lastLapCompleted = -1;
    this.learn = null;
    this.trackMapVersion = 0;
    this.lastTrackMapSent = -1;
    this.classesCache = [];
    this.timing = new TimingTracker();
    this.slip = new SlipEstimator();
    this.gaps = new GapTracker();
  }

  parseInfo(info) {
    this.info = info;
    this.drivers.clear();
    const di = info.DriverInfo || {};
    for (const d of di.Drivers || []) {
      this.drivers.set(d.CarIdx, {
        idx: d.CarIdx,
        name: String(d.UserName || ''),
        abbrev: String(d.AbbrevName || ''),
        initials: String(d.Initials || ''),
        team: String(d.TeamName || ''),
        number: String(d.CarNumber ?? ''),
        classId: d.CarClassID,
        className: String(d.CarClassShortName || d.CarScreenNameShort || ''),
        classColor: hexColor(d.CarClassColor),
        classEst: num(d.CarClassEstLapTime),
        classOrder: 0, renumber: false,
        car: String(d.CarScreenNameShort || d.CarScreenName || ''),
        irating: num(d.IRating),
        license: String(d.LicString || ''),
        licColor: hexColor(d.LicColor, '#888888'),
        isPace: !!d.CarIsPaceCar,
        isSpectator: !!d.IsSpectator,
        userId: d.UserID,
      });
    }
    for (const d of this.drivers.values()) d.base = { classId: d.classId, className: d.className, classColor: d.classColor };
    this.splitRules = undefined; // re-apply league class splits to the new driver list
    const wk = info.WeekendInfo || {};
    this.leagueId = wk.LeagueID || 0;
    const lenStr = String(wk.TrackLength || '0');
    let len = num(lenStr) * (lenStr.includes('mi') ? 1609.34 : 1000);
    this.track = {
      id: `${wk.TrackID}-${wk.TrackConfigName || wk.TrackName || ''}`,
      name: String(wk.TrackDisplayName || wk.TrackName || ''),
      config: String(wk.TrackConfigName || ''),
      length: len || 4000,
    };
    const lim = (wk.WeekendOptions || {}).IncidentLimit;
    this.incidentLimit = lim === 'unlimited' ? 0 : num(lim);
    this.car = {
      fuelMax: num(di.DriverCarFuelMaxLtr) * (num(di.DriverCarMaxFuelPct, 1) || 1),
      slFirst: num(di.DriverCarSLFirstRPM), slShift: num(di.DriverCarSLShiftRPM), slLast: num(di.DriverCarSLLastRPM), slBlink: num(di.DriverCarSLBlinkRPM),
      redline: num(di.DriverCarRedLine), estLap: num(di.DriverCarEstLapTime),
    };
    this.driverCarIdx = di.DriverCarIdx;
    this.timing.setSectors(info);
  }

  sessionDef(num_) {
    const s = ((this.info || {}).SessionInfo || {}).Sessions || [];
    return s.find((x) => x.SessionNum === num_) || s[num_] || {};
  }

  carState(idx) {
    let s = this.perCar.get(idx);
    if (!s) { s = { pitStops: 0, wasPit: false, startPos: 0, lastPitLap: -1 }; this.perCar.set(idx, s); }
    return s;
  }

  update(frame, settings) {
    const v = frame.vars;
    if (frame.sessionInfo && frame.sessionInfoUpdate !== this.siu) {
      this.parseInfo(frame.sessionInfo);
      this.siu = frame.sessionInfoUpdate;
    }
    if (!this.info) return null;
    if (settings.classSplits !== this.splitRules) this.applySplits(settings.classSplits);
    if (frame.demoTrack && !this.trackMaps[frame.demoTrack.id]) this.trackMaps[frame.demoTrack.id] = frame.demoTrack.points;
    if (frame.demoTrack) this.track.id = frame.demoTrack.id;

    if (v.SessionNum !== this.sessionNum) {
      this.sessionNum = v.SessionNum;
      this.perCar.clear();
      this.fuelLaps = [];
      this.fuelLapStart = null;
      this.timing.reset();
      this.gaps.reset();
    }
    const sdef = this.sessionDef(v.SessionNum);
    const kind = sessionKind(sdef.SessionType);
    const isRace = kind === 'race';

    const units = settings.units === 'auto' ? (v.DisplayUnits === 0 ? 'imperial' : 'metric') : settings.units;
    // speed can be switched on its own (km/h <-> mph) without changing fuel / temperature units
    const speedUnits = settings.speedUnit === 'mph' ? 'imperial' : settings.speedUnit === 'kmh' ? 'metric' : units;
    const playerIdx = v.PlayerCarIdx ?? this.driverCarIdx;
    const focusIdx = settings.focusCamCar && v.IsReplayPlaying && v.CamCarIdx >= 0 ? v.CamCarIdx : playerIdx;

    // Race progress per car (laps + fraction), with start/finish line glitches smoothed out.
    const progress = new Map();
    for (const d of this.drivers.values()) {
      if (d.isPace || d.isSpectator) continue;
      progress.set(d.idx, this.gaps.progress(d.idx, v.CarIdxLapCompleted?.[d.idx] ?? -1, v.CarIdxLapDistPct?.[d.idx] ?? -1));
    }
    this.gaps.update(v.SessionTime ?? 0, [...progress].map(([idx, p]) => ({ idx, p })));
    const lapDist = (i) => progress.get(i) ?? ((v.CarIdxLapCompleted?.[i] ?? -1) + Math.max(0, v.CarIdxLapDistPct?.[i] ?? 0));

    // ---- Cars ----
    const cars = [];
    for (const d of this.drivers.values()) {
      if (d.isPace || d.isSpectator) continue;
      const i = d.idx;
      const pct = v.CarIdxLapDistPct?.[i] ?? -1;
      const surface = v.CarIdxTrackSurface?.[i] ?? -1;
      const onPit = !!v.CarIdxOnPitRoad?.[i];
      const st = this.carState(i);
      const lapC = v.CarIdxLapCompleted?.[i] ?? -1;
      if (isRace && v.SessionState >= 4) {
        if (onPit && !st.wasPit && lapC > 0) { st.pitStops++; st.lastPitLap = lapC; }
        if (!st.startPos && (v.CarIdxClassPosition?.[i] || 0) > 0) st.startPos = v.CarIdxClassPosition[i];
        if (!st.startOverall && (v.CarIdxPosition?.[i] || 0) > 0) st.startOverall = v.CarIdxPosition[i];
      }
      st.wasPit = onPit;
      cars.push({
        idx: i, name: d.name, abbrev: d.abbrev, initials: d.initials, team: d.team, number: d.number, car: d.car,
        classId: d.classId, className: d.className, classColor: d.classColor, baseClass: d.base.className,
        irating: d.irating, license: d.license, licColor: d.licColor,
        position: v.CarIdxPosition?.[i] || 0,
        classPosition: v.CarIdxClassPosition?.[i] || 0,
        lap: v.CarIdxLap?.[i] ?? -1, lapCompleted: lapC, pct, dist: lapDist(i),
        surface, inWorld: surface !== -1 && pct >= 0, onPitRoad: onPit, inPitStall: surface === 1,
        lastLap: v.CarIdxLastLapTime?.[i] ?? -1, bestLap: v.CarIdxBestLapTime?.[i] ?? -1,
        f2: v.CarIdxF2Time?.[i] ?? 0, estTime: v.CarIdxEstTime?.[i] ?? 0,
        tire: v.CarIdxTireCompound?.[i] ?? -1,
        pitStops: st.pitStops, startPos: st.startPos,
        isPlayer: i === focusIdx,
        gap: null, interval: null, lapsDown: 0, irDelta: null, posGain: null, fastest: false,
      });
    }

    // Positions: live if available, else session results, else by best lap.
    const results = sdef.ResultsPositions || [];
    const resPos = new Map(results.map((r) => [r.CarIdx, r]));
    // Live lap arrays are -1 for cars not currently in the world, so fill from results.
    for (const c of cars) {
      const r = resPos.get(c.idx);
      if (!r) continue;
      if (!c.position) {
        c.position = r.Position;
        c.classPosition = r.ClassPosition + 1;
      }
      if (c.bestLap <= 0 && num(r.FastestTime, -1) > 0) c.bestLap = num(r.FastestTime);
      if (c.lastLap <= 0 && num(r.LastTime, -1) > 0) c.lastLap = num(r.LastTime);
      if (c.lapCompleted < 0 && r.LapsComplete >= 0) c.lapCompleted = r.LapsComplete;
    }

    // ---- Classes ----
    const classMap = new Map();
    for (const c of cars) {
      let k = classMap.get(c.classId);
      if (!k) {
        const d = this.drivers.get(c.idx);
        // renumber: a league split moved cars in or out, so iRacing's class positions don't apply as-is
        k = { id: c.classId, name: c.className, color: c.classColor, count: 0, irSum: 0, sof: 0, bestLap: -1, cars: [], order: d.classOrder, renumber: d.renumber };
        classMap.set(c.classId, k);
      }
      k.count++;
      k.cars.push(c);
      if (c.bestLap > 0 && (k.bestLap < 0 || c.bestLap < k.bestLap)) k.bestLap = c.bestLap;
    }
    const classes = [...classMap.values()];
    const br = 1600 / Math.LN2;
    for (const k of classes) {
      // iRacing SOF: exponential average
      const sum = k.cars.reduce((a, c) => a + Math.exp(-c.irating / br), 0);
      k.sof = k.count ? Math.round(br * Math.log(k.count / sum)) : 0;

      // order within class
      k.cars.sort((a, b) => {
        const pa = a.classPosition || a.position, pb = b.classPosition || b.position;
        if (pa && pb) return pa - pb;
        if (pa) return -1;
        if (pb) return 1;
        if (a.bestLap > 0 && b.bestLap > 0) return a.bestLap - b.bestLap;
        if (a.bestLap > 0) return -1;
        if (b.bestLap > 0) return 1;
        return a.idx - b.idx;
      });
      k.cars.forEach((c, n) => { if (!c.classPosition || k.renumber) c.classPosition = n + 1; });
      if (k.renumber && isRace) {
        // start position within the sub-class, from the overall grid order
        const grid = k.cars.filter((c) => this.carState(c.idx).startOverall).sort((a, b) => this.carState(a.idx).startOverall - this.carState(b.idx).startOverall);
        k.cars.forEach((c) => { const r = grid.indexOf(c); c.startPos = r >= 0 ? r + 1 : 0; });
      }

      const leader = k.cars[0];
      const estLap = leader ? (this.classEst(leader) || 90) : 90;
      k.cars.forEach((c, n) => {
        if (c.bestLap > 0 && c.bestLap === k.bestLap) c.fastest = true;
        if (isRace) {
          const ahead = k.cars[n - 1];
          c.lapsDown = Math.max(0, Math.floor(leader.dist - c.dist + 0.0001));
          // Own timing loops first; CarIdxF2Time only updates at timing lines in races.
          c.gap = n === 0 ? 0 : this.gaps.gap(leader.idx, c.idx);
          if (c.gap === null) c.gap = c.f2 - leader.f2;
          if (!(c.gap >= 0) || c.gap > estLap * 3) c.gap = ((leader.dist - c.dist) * estLap);
          if (n === 0) c.interval = null;
          else {
            c.interval = this.gaps.gap(ahead.idx, c.idx);
            if (c.interval === null) c.interval = Math.max(0, c.gap - ahead.gap);
          }
          if (c.startPos) c.posGain = c.startPos - c.classPosition;
        } else if (c.bestLap > 0 && k.bestLap > 0) {
          c.gap = c.bestLap - k.bestLap;
          const ahead = k.cars[n - 1];
          c.interval = ahead && ahead.bestLap > 0 ? c.bestLap - ahead.bestLap : null;
        }
      });
      if (isRace || kind === 'qualify') {
        const entries = k.cars.map((c, n) => ({ ir: c.irating || 1350, pos: n + 1 }));
        const deltas = iratingDeltas(entries);
        k.cars.forEach((c, n) => { c.irDelta = deltas[n]; });
      }
      delete k.cars; // not sent, cars carry their own class info
      k.irSum = undefined;
      k.renumber = undefined;
    }
    classes.sort((a, b) => {
      // faster class first, by estimated lap time
      const ea = this.classEstById(a.id), eb = this.classEstById(b.id);
      return (ea || 1e9) - (eb || 1e9) || a.order - b.order || String(a.name).localeCompare(String(b.name));
    });

    const me = cars.find((c) => c.isPlayer);

    // ---- Relative ----
    const relative = [];
    if (me && me.inWorld) {
      const lapT = this.classEst(me) || this.car.estLap || 90;
      for (const c of cars) {
        if (!c.inWorld || c.isPlayer) continue;
        let dPct = c.pct - me.pct;
        if (dPct > 0.5) dPct -= 1;
        if (dPct < -0.5) dPct += 1;
        let gap;
        // CarIdxEstTime runs on each car's own class lap estimate, so bring other classes onto ours
        // (otherwise a faster-class car just ahead reads as behind)
        const theirEst = this.classEst(c);
        const eo = theirEst > 0 ? c.estTime * (lapT / theirEst) : c.estTime, em = me.estTime;
        if (eo > 0 && em > 0) {
          gap = eo - em;
          if (gap > lapT / 2) gap -= lapT;
          if (gap < -lapT / 2) gap += lapT;
          // fall back when est time disagrees wildly with track position
          if (Math.sign(gap) !== Math.sign(dPct) && Math.abs(dPct) > 0.02) gap = dPct * lapT;
        } else gap = dPct * lapT;
        const raceDiff = c.dist - me.dist;
        const lapDiff = isRace ? (raceDiff > 0.5 ? 1 : raceDiff < -0.5 ? -1 : 0) : 0;
        relative.push({ idx: c.idx, gap, dPct, lapDiff, meters: dPct * this.track.length });
      }
      relative.sort((a, b) => b.gap - a.gap);
    }

    // ---- Radar ----
    const radar = { state: v.CarLeftRight ?? 0, cars: [] };
    if (me && me.inWorld) {
      for (const r of relative) {
        if (Math.abs(r.meters) < 100) {
          const c = cars.find((x) => x.idx === r.idx);
          if (c && !c.onPitRoad) radar.cars.push({ idx: r.idx, meters: r.meters, classColor: c.classColor, number: c.number });
        }
      }
    }

    // ---- Fuel ----
    const fuelLevel = v.FuelLevel ?? 0;
    const lapCompleted = v.LapCompleted ?? -1;
    if (this.fuelLapStart === null && v.IsOnTrack) this.fuelLapStart = { lap: lapCompleted, fuel: fuelLevel, pit: false, partial: true };
    if (this.fuelLapStart) {
      if (v.OnPitRoad) this.fuelLapStart.pit = true;
      if (lapCompleted !== this.fuelLapStart.lap) {
        const used = this.fuelLapStart.fuel - fuelLevel;
        const valid = lapCompleted === this.fuelLapStart.lap + 1 && !this.fuelLapStart.partial && !this.fuelLapStart.pit && used > 0 && !(v.SessionFlags & 0x4000);
        if (valid) { this.fuelLaps.push(used); if (this.fuelLaps.length > 50) this.fuelLaps.shift(); }
        this.fuelLapStart = { lap: lapCompleted, fuel: fuelLevel, pit: !!v.OnPitRoad };
      }
      if (fuelLevel > this.fuelLapStart.fuel + 0.5) this.fuelLapStart.fuel = fuelLevel; // refuelled
    }
    const sessionLaps = num(sdef.SessionLaps, 0);
    let lapsRemain = v.SessionLapsRemainEx;
    if (!(lapsRemain >= 0) || lapsRemain >= 32767) lapsRemain = null;
    const timeRemain = v.SessionTimeRemain >= 0 && v.SessionTimeRemain < 604800 ? v.SessionTimeRemain : null;

    const bestLapMe = me && me.bestLap > 0 ? me.bestLap : 0;
    const refLap = (me && me.lastLap > 0 ? me.lastLap : 0) || bestLapMe || this.classEst(me) || this.car.estLap || 90;
    let lapsToGo = lapsRemain;
    if (timeRemain !== null && refLap > 0) {
      const byTime = Math.ceil(timeRemain / refLap + (me ? 1 - Math.max(0, me.pct) : 0));
      lapsToGo = lapsToGo === null ? byTime : Math.min(lapsToGo, byTime);
    }
    if (lapsToGo !== null && me) lapsToGo = Math.max(0, lapsToGo - Math.max(0, me.pct));

    const fuel = {
      level: fuelLevel, pct: v.FuelLevelPct ?? 0, perHour: v.FuelUsePerHour ?? 0, max: this.car.fuelMax,
      laps: this.fuelLaps.slice(-20), lapsToGo, pitFuel: v.PitSvFuel,
    };

    // ---- Sector timing & slip ----
    const timing = this.timing.update(v, playerIdx, (i) => (this.drivers.get(i) || {}).classId);
    const slip = this.slip.update(v);

    // ---- Track map learning ----
    this.learnTrack(v, me);
    const pts = this.trackMaps[this.track.id];
    const trackMap = { id: this.track.id, points: pts || null, learning: pts ? 1 : this.learningProgress() };

    // ---- Session ----
    const pc = me ? classes.find((k) => k.id === me.classId) : null;
    const session = {
      kind, isRace, type: String(sdef.SessionType || ''), name: String(sdef.SessionName || ''), num: v.SessionNum,
      state: v.SessionState, flags: v.SessionFlags >>> 0, carFlags: me ? (v.CarIdxSessionFlags?.[me.idx] >>> 0) : 0,
      timeRemain, timeTotal: v.SessionTimeTotal < 604800 ? v.SessionTimeTotal : null,
      lapsRemain, lapsTotal: sessionLaps || null, lapsToGo,
      time: v.SessionTime, timeOfDay: v.SessionTimeOfDay,
      track: this.track, units, speedUnits,
      airTemp: v.AirTemp, trackTemp: v.TrackTempCrew, wetness: v.TrackWetness, skies: v.Skies,
      windVel: v.WindVel, windDir: v.WindDir, humidity: v.RelativeHumidity,
      incidentLimit: this.incidentLimit,
      sof: pc ? pc.sof : 0,
      leaderLap: Math.max(0, ...cars.map((c) => c.lap)),
      replay: !!v.IsReplayPlaying,
    };

    const player = {
      carIdx: playerIdx, focusIdx, onTrack: !!v.IsOnTrack, inGarage: !!v.IsInGarage, inPitStall: !!v.PlayerCarInPitStall,
      speed: v.Speed ?? 0, rpm: v.RPM ?? 0, gear: v.Gear ?? 0,
      throttle: v.Throttle ?? 0, brake: v.Brake ?? 0, clutch: 1 - (v.Clutch ?? 1), clutchRaw: v.Clutch ?? 0,
      steer: v.SteeringWheelAngle ?? 0, steerMax: v.SteeringWheelAngleMax || 7.85, abs: !!v.BrakeABSactive,
      lap: v.Lap ?? 0, lapCompleted, lapPct: v.LapDistPct ?? 0,
      lapTime: v.LapCurrentLapTime ?? 0, lastLap: v.LapLastLapTime ?? -1, bestLap: v.LapBestLapTime ?? -1,
      position: me ? me.position : v.PlayerCarPosition, classPosition: me ? me.classPosition : v.PlayerCarClassPosition,
      classCount: pc ? pc.count : cars.length,
      incidents: v.PlayerCarMyIncidentCount ?? v.PlayerCarDriverIncidentCount ?? 0,
      onPitRoad: !!v.OnPitRoad,
      fuel: fuelLevel,
      deltas: {
        best: [v.LapDeltaToBestLap, v.LapDeltaToBestLap_DD, v.LapDeltaToBestLap_OK],
        optimal: [v.LapDeltaToOptimalLap, v.LapDeltaToOptimalLap_DD, v.LapDeltaToOptimalLap_OK],
        sessionBest: [v.LapDeltaToSessionBestLap, v.LapDeltaToSessionBestLap_DD, v.LapDeltaToSessionBestLap_OK],
        sessionOptimal: [v.LapDeltaToSessionOptimalLap, v.LapDeltaToSessionOptimalLap_DD, v.LapDeltaToSessionOptimalLap_OK],
        sessionLast: [v.LapDeltaToSessionLastlLap, v.LapDeltaToSessionLastlLap_DD, v.LapDeltaToSessionLastlLap_OK],
      },
      shift: this.car, shiftPct: v.ShiftIndicatorPct,
      carLeftRight: v.CarLeftRight ?? 0,
      waterTemp: v.WaterTemp, oilTemp: v.OilTemp, oilPress: v.OilPress, voltage: v.Voltage, engineWarnings: v.EngineWarnings ?? 0,
      brakeBias: v.dcBrakeBias, repairLeft: v.PitRepairLeft, optRepairLeft: v.PitOptRepairLeft,
      estLap: this.classEst(me) || this.car.estLap,
      slip,
    };

    // Fill in "vs best" / "vs last" from our own lap traces when iRacing has no valid delta
    // (e.g. no best lap recorded by iRacing yet, or after an off-track).
    const own = (which) => this.timing.delta(which, v.SessionTime, playerIdx);
    if (!player.deltas.best[2]) player.deltas.best = own('best');
    if (!player.deltas.sessionLast[2]) player.deltas.sessionLast = own('last');
    if (!(player.bestLap > 0) && timing.bestLap) player.bestLap = timing.bestLap;
    if (!(player.lastLap > 0) && timing.log.length) player.lastLap = timing.log[timing.log.length - 1].time;

    return { connected: true, session, player, cars, classes, relative, radar, fuel, trackMap, timing };
  }

  // League class splits (settings.classSplits): move cars into custom sub-classes.
  applySplits(rules) {
    this.splitRules = rules;
    const drivers = [...this.drivers.values()].filter((d) => !d.isPace && !d.isSpectator);
    for (const d of drivers) Object.assign(d, d.base, { classOrder: 0, renumber: false });
    const splits = assignSplits(drivers.map((d) => ({ ...d, ...d.base })), rules, this.leagueId);
    const affected = new Set();
    for (const d of drivers) {
      const sp = splits.get(d.idx);
      if (!sp) continue;
      affected.add(d.base.classId);
      Object.assign(d, { classId: sp.id, className: sp.name, classColor: sp.color, classOrder: sp.order });
    }
    for (const d of drivers) if (affected.has(d.base.classId)) d.renumber = true;
  }

  // Everyone in the session with their iRacing class and the sub-class they are split into (settings preview).
  classPreview(rules) {
    const drivers = [...this.drivers.values()].filter((d) => !d.isPace && !d.isSpectator).map((d) => ({ ...d, ...d.base }));
    const splits = assignSplits(drivers, rules, this.leagueId);
    return {
      leagueId: this.leagueId,
      drivers: drivers.map((d) => {
        const sp = splits.get(d.idx);
        return { name: d.name, number: d.number, userId: d.userId, irating: d.irating, baseClass: d.className, baseColor: d.classColor, split: sp ? sp.name : '', splitColor: sp ? sp.color : '' };
      }),
    };
  }

  classEst(car) {
    if (!car) return 0;
    const d = this.drivers.get(car.idx);
    return d ? d.classEst : 0;
  }

  classEstById(id) {
    for (const d of this.drivers.values()) if (d.classId === id && d.classEst) return d.classEst;
    return 0;
  }

  // Learn the track shape by dead-reckoning the player's car during a clean lap.
  learnTrack(v, me) {
    const id = this.track.id;
    if (this.trackMaps[id] || !me || !v.IsOnTrack || v.OnPitRoad || v.VelocityX === undefined || v.Yaw === undefined) {
      if (this.learn && (v.OnPitRoad || !v.IsOnTrack)) this.learn = null;
      return;
    }
    const pct = me.pct;
    const t = v.SessionTime;
    if (!this.learn || this.learn.id !== id) {
      if (pct > 0.02) return; // start learning at the line
      this.learn = { id, x: 0, y: 0, t, pts: new Array(TRACK_BINS).fill(null), lastPct: pct, lastBin: -1 };
      return;
    }
    const L = this.learn;
    const dt = t - L.t;
    L.t = t;
    if (dt <= 0 || dt > 0.5) { this.learn = null; return; }
    const vx = v.VelocityX, vy = v.VelocityY || 0, yaw = v.Yaw;
    L.x += (vx * Math.cos(yaw) - vy * Math.sin(yaw)) * dt;
    L.y += (vx * Math.sin(yaw) + vy * Math.cos(yaw)) * dt;
    if (pct < L.lastPct - 0.5) {
      // lap complete: fill gaps, close the loop by distributing the drift
      const pts = L.pts;
      const filled = pts.filter(Boolean).length;
      this.learn = null;
      if (filled < TRACK_BINS * 0.8) return;
      for (let i = 0; i < TRACK_BINS; i++) {
        if (pts[i]) continue;
        let a = i - 1; while (a >= 0 && !pts[a]) a--;
        let b = i + 1; while (b < TRACK_BINS && !pts[b]) b++;
        const pa = pts[Math.max(a, 0)] || pts[b], pb = pts[Math.min(b, TRACK_BINS - 1)] || pa;
        const f = (i - a) / (b - a || 1);
        pts[i] = [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f];
      }
      const ex = L.x - pts[0][0], ey = L.y - pts[0][1];
      const shape = pts.map((p, i) => [p[0] - ex * (i / TRACK_BINS), p[1] - ey * (i / TRACK_BINS)]);
      this.trackMaps[id] = shape;
      this.onTrackLearned(id, shape);
      return;
    }
    L.lastPct = pct;
    const bin = Math.min(TRACK_BINS - 1, Math.floor(pct * TRACK_BINS));
    if (!L.pts[bin]) L.pts[bin] = [L.x, L.y];
  }

  learningProgress() {
    if (!this.learn) return 0;
    return this.learn.lastPct;
  }
}

module.exports = { RaceModel, iratingDeltas, hexColor };
