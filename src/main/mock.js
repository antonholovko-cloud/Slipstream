/*
 * Demo telemetry: a simulated 2-class race on a synthetic circuit, emitted in the
 * same shape as the real iRacing reader so every overlay can be designed and
 * tested without the sim running.
 */

const TRACK_LEN = 4200; // m
const N = 1000; // track samples

function buildTrack() {
  // Closed parametric curve, re-sampled by arc length.
  const raw = [];
  for (let i = 0; i <= 4000; i++) {
    const t = (i / 4000) * Math.PI * 2;
    const r = 1 + 0.28 * Math.sin(3 * t) + 0.12 * Math.cos(5 * t + 1) + 0.05 * Math.sin(9 * t);
    raw.push([Math.cos(t) * r, Math.sin(t) * r * 0.75]);
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = cum[cum.length - 1];
  const scale = TRACK_LEN / total;
  const pts = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = (i / N) * total;
    while (cum[j + 1] < d) j++;
    const f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push([(raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f) * scale, (raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f) * scale]);
  }
  const ds = TRACK_LEN / N;
  const heading = [], curv = [];
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    heading.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
  }
  for (let i = 0; i < N; i++) {
    let dh = heading[(i + 1) % N] - heading[(i - 1 + N) % N];
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    curv.push(dh / (2 * ds));
  }
  // Speed profile: lateral grip limit, then braking / acceleration passes.
  const vmax = curv.map((k) => Math.min(78, Math.sqrt(22 / Math.max(Math.abs(k), 1e-4))));
  const v = vmax.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N; i++) { // accel
      const p = v[(i - 1 + N) % N];
      v[i] = Math.min(v[i], Math.sqrt(p * p + 2 * 7 * ds));
    }
    for (let i = N - 1; i >= 0; i--) { // braking
      const nx = v[(i + 1) % N];
      v[i] = Math.min(v[i], Math.sqrt(nx * nx + 2 * 14 * ds));
    }
  }
  const timeAt = [0];
  for (let i = 1; i <= N; i++) timeAt.push(timeAt[i - 1] + ds / v[i - 1]);
  return { pts, heading, curv, v, timeAt, lapTime: timeAt[N] };
}

const FIRST = ['Max', 'Lewis', 'Charles', 'Lando', 'Oscar', 'Fernando', 'Carlos', 'George', 'Sergio', 'Valtteri', 'Kevin', 'Nico', 'Yuki', 'Alex', 'Pierre', 'Esteban', 'Lance', 'Daniel', 'Mick', 'Zhou', 'Logan', 'Oliver', 'Liam', 'Franco'];
const LAST = ['Verstappen', 'Hamilton', 'Leclerc', 'Norris', 'Piastri', 'Alonso', 'Sainz', 'Russell', 'Perez', 'Bottas', 'Magnussen', 'Hülkenberg', 'Tsunoda', 'Albon', 'Gasly', 'Ocon', 'Stroll', 'Ricciardo', 'Schumacher', 'Guanyu', 'Sargeant', 'Bearman', 'Lawson', 'Colapinto'];
const LIC = [['A', 0x0153db], ['B', 0x00c702], ['C', 0xfeec04], ['D', 0xfc8a27], ['P', 0x000000]];

function rnd(seed) { // deterministic PRNG
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

class MockSource {
  constructor() {
    this.track = buildTrack();
    this.t0 = Date.now();
    this.last = this.t0;
    this.sessionTime = 0;
    this.sessionInfoUpdate = 1;
    this.playerIdx = 9;
    this.raceLaps = 20;
    const r = rnd(42);
    this.cars = [];
    const classes = [
      { id: 4029, short: 'LMP2', color: 0x33ceff, car: 'Dallara P217', speed: 1.1 },
      { id: 2708, short: 'GT3', color: 0xffda59, car: 'Porsche 911 GT3 R', speed: 1.0 },
    ];
    // pace car at idx 0 (hidden) like iRacing
    this.cars.push({ idx: 0, pace: true });
    for (let i = 1; i <= 22; i++) {
      const cls = i <= 8 ? classes[0] : classes[1];
      const lic = LIC[Math.floor(r() * 3)];
      this.cars.push({
        idx: i, cls,
        name: FIRST[(i - 1) % FIRST.length] + ' ' + LAST[(i * 7) % LAST.length],
        number: String(((i * 37) % 97) + 1),
        irating: Math.round(1400 + r() * 3600),
        lic: `${lic[0]} ${(1 + r() * 3.99).toFixed(2)}`,
        licColor: lic[1],
        skill: cls.speed * (0.975 + r() * 0.025),
        dist: -((i - 1) * 0.012) - (i > 8 ? 0.04 : 0), // grid, laps as float
        lastLap: -1, bestLap: -1, lapStart: 0,
        pit: null, pitLap: 5 + Math.floor(r() * 10),
        tire: 0,
      });
    }
    // make a rival that duels with the player
    this.cars[this.playerIdx].skill = 0.99;
    this.cars[this.playerIdx].name = 'You Driver';
    this.cars[this.playerIdx].irating = 2450;
    this.cars[this.playerIdx + 1].skill = 0.99;
    this.fuel = 42;
    this.fuelHist = 0;
    this.bestTrace = null; // time-at-bin for player's best lap
    this.curTrace = new Array(201).fill(0);
    this.playerLapSkill = 0.99;
    this.flagTimer = 0;
    this.incidents = 0;
    this.buildSessionInfo();
  }

  buildSessionInfo() {
    const drivers = this.cars.map((c) => c.pace ? {
      CarIdx: 0, UserName: 'Pace Car', AbbrevName: '', Initials: '', UserID: -1, TeamName: 'Pace Car', CarNumber: '0', CarNumberRaw: 0,
      CarClassID: 11, CarClassShortName: '', CarClassColor: 0xffffff, CarScreenNameShort: 'Safety Car', IRating: 0, LicString: 'R 0.00', LicColor: 0xffffff, IsSpectator: 0, CarIsPaceCar: 1,
    } : {
      CarIdx: c.idx, UserName: c.name, AbbrevName: c.name.split(' ')[1] + ', ' + c.name[0], Initials: c.name.split(' ').map((s) => s[0]).join(''), UserID: 100000 + c.idx,
      TeamName: c.name, CarNumber: c.number, CarNumberRaw: +c.number, CarClassID: c.cls.id, CarClassShortName: c.cls.short, CarClassColor: c.cls.color,
      CarClassEstLapTime: this.track.lapTime / c.cls.speed, CarScreenNameShort: c.cls.car, IRating: c.irating, LicString: c.lic, LicColor: c.licColor, IsSpectator: 0, CarIsPaceCar: 0,
    });
    this.sessionInfo = {
      WeekendInfo: { TrackName: 'demo', TrackID: -1, TrackDisplayName: 'Demo Raceway', TrackConfigName: 'Grand Prix', TrackLength: (TRACK_LEN / 1000).toFixed(2) + ' km', TrackCity: 'Nowhere', TrackCountry: 'Demo', WeekendOptions: { IncidentLimit: 17 }, SubSessionID: 1 },
      SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: 'Race', SessionName: 'RACE', SessionLaps: this.raceLaps, SessionTime: 'unlimited', ResultsPositions: null }] },
      DriverInfo: {
        DriverCarIdx: this.playerIdx, DriverCarFuelMaxLtr: 100, DriverCarMaxFuelPct: 1, DriverCarSLFirstRPM: 6500, DriverCarSLShiftRPM: 7700, DriverCarSLLastRPM: 7950, DriverCarSLBlinkRPM: 8100,
        DriverCarRedLine: 8300, DriverCarEstLapTime: this.track.lapTime / 0.99, Drivers: drivers,
      },
    };
  }

  sampleAt(pct) {
    const f = ((pct % 1) + 1) % 1 * N;
    const i = Math.floor(f) % N;
    return { i, f: f - Math.floor(f) };
  }

  timeAtPct(pct) {
    const { i, f } = this.sampleAt(pct);
    return this.track.timeAt[i] + (this.track.timeAt[i + 1] - this.track.timeAt[i]) * f;
  }

  // Simulate `seconds` of racing instantly (used to preview a race in progress).
  fastForward(seconds, onFrame) {
    for (let t = 0; t < seconds; t += 1 / 20) {
      const f = this.step(1 / 20);
      if (onFrame) onFrame(f);
    }
  }

  read() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (dt <= 0) return null;
    return this.step(dt);
  }

  step(dt) {
    this.sessionTime += dt;
    const T = this.track;
    const racing = true;
    const vars = {};
    const n = 64;
    const arr = (v) => new Array(n).fill(v);
    const lapArr = arr(-1), lapComp = arr(-1), pctArr = arr(-1), surf = arr(-1), pitArr = arr(false), posArr = arr(0), cposArr = arr(0), f2 = arr(0), est = arr(0), lastArr = arr(-1), bestArr = arr(-1), tire = arr(0);

    for (const c of this.cars) {
      if (c.pace) continue;
      const pct = ((c.dist % 1) + 1) % 1;
      const { i } = this.sampleAt(pct);
      let speed = T.v[i] * c.skill * (c.idx === this.playerIdx ? this.playerLapSkill / 0.99 : 1);
      if (c.idx === this.playerIdx + 1) speed *= 1 + 0.012 * Math.sin(this.sessionTime / 23);
      // pit stop state machine
      const lap = Math.floor(c.dist);
      if (!c.pit && lap === c.pitLap && pct > 0.95) c.pit = { stage: 'in', stop: 0 };
      if (c.pit) {
        speed = Math.min(speed, 22);
        if (c.pit.stage === 'in' && pct < 0.5 && pct > 0.01) { c.pit.stage = 'stop'; c.pit.stop = 22; }
        if (c.pit.stage === 'stop') { speed = 0; c.pit.stop -= dt; if (c.pit.stop <= 0) c.pit.stage = 'out'; c.tire = 1; }
        if (c.pit.stage === 'out' && pct > 0.06 && pct < 0.5) c.pit = null;
      }
      c.speed = speed;
      const prevLap = Math.floor(c.dist);
      c.dist += (speed * dt) / TRACK_LEN;
      const newLap = Math.floor(c.dist);
      if (newLap > prevLap && newLap >= 1) {
        const lt = this.sessionTime - c.lapStart;
        if (newLap >= 2 || c.lapStart > 0) {
          c.lastLap = lt;
          if (c.bestLap < 0 || lt < c.bestLap) c.bestLap = lt;
        }
        c.lapStart = this.sessionTime;
        if (c.idx === this.playerIdx) this.onPlayerLap(lt);
      }
      const p2 = ((c.dist % 1) + 1) % 1;
      lapArr[c.idx] = Math.max(0, Math.floor(c.dist) + 1);
      lapComp[c.idx] = Math.max(-1, Math.floor(c.dist));
      pctArr[c.idx] = p2;
      surf[c.idx] = c.pit ? (c.pit.stage === 'stop' ? 1 : 2) : 3;
      pitArr[c.idx] = !!c.pit;
      est[c.idx] = this.timeAtPct(p2) / c.skill;
      lastArr[c.idx] = c.lastLap;
      bestArr[c.idx] = c.bestLap;
      tire[c.idx] = c.tire;
    }

    // positions (overall and class) by race distance
    const running = this.cars.filter((c) => !c.pace).sort((a, b) => b.dist - a.dist);
    const classCount = {};
    const leader = running[0];
    const leaderSpeed = TRACK_LEN / T.lapTime * leader.skill;
    running.forEach((c, k) => {
      posArr[c.idx] = k + 1;
      classCount[c.cls.id] = (classCount[c.cls.id] || 0) + 1;
      cposArr[c.idx] = classCount[c.cls.id];
      f2[c.idx] = ((leader.dist - c.dist) * TRACK_LEN) / leaderSpeed;
    });

    // player
    const me = this.cars[this.playerIdx];
    const pct = pctArr[me.idx];
    const { i } = this.sampleAt(pct);
    const vNow = me.speed;
    const vNext = T.v[(i + 6) % N] * me.skill;
    const accel = (vNext - vNow);
    let throttle = accel > 0.3 ? 1 : accel > -0.5 ? 0.55 + 0.3 * Math.sin(this.sessionTime * 3) : 0;
    let brake = accel < -1.5 ? Math.min(1, -accel / 10) : 0;
    if (me.pit) { throttle = me.pit.stage === 'stop' ? 0 : 0.3; brake = me.pit.stage === 'stop' ? 0.2 : 0; }
    const gears = [0, 18, 30, 42, 54, 66, 99];
    let gear = 1;
    while (gear < 6 && vNow > gears[gear]) gear++;
    const lo = gears[gear - 1], hi = gears[gear];
    const rpm = vNow < 0.5 ? 900 : 3500 + ((vNow - lo) / (hi - lo)) * 4800;
    const steer = Math.max(-4, Math.min(4, Math.atan(T.curv[i] * 2.7) * 14));

    this.fuel = Math.max(0, this.fuel - (0.0000285 * throttle * vNow + 0.00001) * dt * 60);
    this.curTrace[Math.round(pct * 200)] = this.sessionTime - me.lapStart;
    const elapsed = this.sessionTime - me.lapStart;
    let delta = 0, deltaOk = false;
    if (this.bestTrace) {
      const b = Math.round(pct * 200);
      delta = elapsed - this.bestTrace[b];
      deltaOk = true;
    }

    // radar
    let left = 0, right = 0;
    const near = [];
    for (const c of this.cars) {
      if (c.pace || c.idx === me.idx || c.pit) continue;
      let d = (pctArr[c.idx] - pct);
      if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
      const m = d * TRACK_LEN;
      if (Math.abs(m) < 5.5) { if (c.idx % 2) left++; else right++; }
      near.push(m);
    }
    const clr = left && right ? 4 : left >= 2 ? 5 : right >= 2 ? 6 : left ? 2 : right ? 3 : 1;

    // flags: periodic local yellow and blue when being lapped
    this.flagTimer += dt;
    let flags = 0x4; // green
    if (this.flagTimer % 120 > 100 && this.flagTimer % 120 < 110) flags = 0x8 | 0x100;
    const lapping = running.find((c) => c.cls.id !== me.cls.id && c.dist > me.dist && (c.dist - me.dist) % 1 > 0.985);
    if (lapping) flags |= 0x20;
    if (this.fuel < 1) flags |= 0x100000;

    const leaderLaps = Math.floor(leader.dist);

    Object.assign(vars, {
      SessionTime: this.sessionTime, SessionTick: Math.round(this.sessionTime * 60), SessionNum: 0, SessionState: racing ? 4 : 3, SessionFlags: flags,
      SessionTimeRemain: 604800, SessionLapsRemainEx: Math.max(0, this.raceLaps - leaderLaps), SessionTimeTotal: 604800, SessionLapsTotal: this.raceLaps, SessionTimeOfDay: 14 * 3600 + this.sessionTime,
      PlayerCarIdx: me.idx, PlayerCarPosition: posArr[me.idx], PlayerCarClassPosition: cposArr[me.idx], PlayerCarMyIncidentCount: this.incidents, PlayerCarTeamIncidentCount: this.incidents, PlayerCarDriverIncidentCount: this.incidents,
      PlayerTrackSurface: surf[me.idx], PlayerCarInPitStall: me.pit && me.pit.stage === 'stop',
      IsOnTrack: true, IsOnTrackCar: true, IsInGarage: false, IsReplayPlaying: false, OnPitRoad: !!me.pit, CamCarIdx: me.idx, DisplayUnits: 1,
      CarIdxLap: lapArr, CarIdxLapCompleted: lapComp, CarIdxLapDistPct: pctArr, CarIdxTrackSurface: surf, CarIdxOnPitRoad: pitArr, CarIdxPosition: posArr, CarIdxClassPosition: cposArr,
      CarIdxF2Time: f2, CarIdxEstTime: est, CarIdxLastLapTime: lastArr, CarIdxBestLapTime: bestArr, CarIdxTireCompound: tire,
      CarLeftRight: clr,
      Speed: vNow, RPM: rpm, Gear: vNow < 0.5 ? 0 : gear, Throttle: throttle, Brake: brake, Clutch: vNow < 3 ? 0 : 1, SteeringWheelAngle: steer, SteeringWheelAngleMax: 7.85, BrakeABSactive: brake > 0.85,
      FuelLevel: this.fuel, FuelLevelPct: this.fuel / 100, FuelUsePerHour: throttle * 95 + 5,
      Lap: lapArr[me.idx], LapCompleted: lapComp[me.idx], LapDistPct: pct, LapDist: pct * TRACK_LEN, LapCurrentLapTime: elapsed, LapLastLapTime: me.lastLap, LapBestLapTime: me.bestLap,
      LapDeltaToBestLap: delta, LapDeltaToBestLap_DD: (this.playerLapSkill - 0.99) * -50, LapDeltaToBestLap_OK: deltaOk,
      LapDeltaToOptimalLap: delta + 0.25, LapDeltaToOptimalLap_DD: 0, LapDeltaToOptimalLap_OK: deltaOk,
      LapDeltaToSessionBestLap: delta + 0.6, LapDeltaToSessionBestLap_DD: 0, LapDeltaToSessionBestLap_OK: deltaOk,
      LapDeltaToSessionOptimalLap: delta + 0.8, LapDeltaToSessionOptimalLap_DD: 0, LapDeltaToSessionOptimalLap_OK: deltaOk,
      LapDeltaToSessionLastlLap: delta - 0.1, LapDeltaToSessionLastlLap_DD: 0, LapDeltaToSessionLastlLap_OK: deltaOk,
      AirTemp: 24.5, TrackTempCrew: 38.2, TrackWetness: 1, Skies: 1, WindVel: 3.2, WindDir: 1.2, RelativeHumidity: 0.45,
      VelocityX: vNow, VelocityY: 0, Yaw: T.heading[i],
      WaterTemp: 88 + Math.sin(this.sessionTime / 30) * 3, OilTemp: 102, OilPress: 5.1, Voltage: 13.8, EngineWarnings: 0, dcBrakeBias: 54.5,
    });

    return {
      vars,
      sessionInfo: this.sessionInfo,
      sessionInfoUpdate: this.sessionInfoUpdate,
      tickRate: 60,
      demoTrack: { id: 'demo-grand-prix', points: T.pts.filter((_, k) => k % 2 === 0) },
    };
  }

  onPlayerLap(lt) {
    if (!this.bestTrace || lt < this.bestTrace[200]) {
      this.curTrace[200] = lt;
      this.bestTrace = this.curTrace.slice();
    }
    this.curTrace = new Array(201).fill(0);
    this.playerLapSkill = 0.985 + Math.random() * 0.012;
    if (Math.random() < 0.15) this.incidents += 1 + Math.floor(Math.random() * 2) * 3;
  }
}

module.exports = { MockSource };
