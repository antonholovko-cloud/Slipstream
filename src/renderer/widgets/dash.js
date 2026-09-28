/*
 * Dashboard & Inputs: shift lights, gear/speed/RPM, pedal trace, pedal bars and
 * steering wheel in one overlay. Each block can be turned off in settings and
 * the remaining ones reflow.
 */
Host.css(`
.dash { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:.35rem .6rem .3rem; gap:.35rem; }
.dash .lights { display:flex; gap:.2rem; flex:none; }
.dash .lights i { flex:1; height:.3rem; border-radius:2px; background:rgba(255,255,255,.08); }
.dash .lights.flash i:not(.slip) { animation: dashflash .12s steps(2) infinite; }
.dash .lights i.slip { transition: background .08s, box-shadow .08s; }
.dash .lights i.slip.start { margin-right:.3rem; }
.dash .lights i.slip.end { margin-left:.3rem; }
@keyframes dashflash { 50% { opacity:.15 } }
.dash .main { display:flex; align-items:center; gap:.7rem; height:3rem; flex:none; }
.dash .gearbox { display:flex; align-items:center; gap:.55rem; flex:none; }
.dash .gear { font-size:2.5rem; font-weight:700; line-height:1; min-width:1.6rem; text-align:center; }
.dash .gcol { display:flex; flex-direction:column; justify-content:center; gap:.2rem; width:4.8rem; }
.dash .speed { font-size:1.3rem; font-weight:700; line-height:1; }
.dash .speed small, .dash .rpm small { font-size:.65rem; color:var(--dim); margin-left:.2rem; font-weight:600; }
.dash .rpm { font-size:.75rem; color:var(--dim); line-height:1; }
.dash .rpmbar { height:.22rem; background:rgba(255,255,255,.08); border-radius:2px; overflow:hidden; }
.dash .rpmbar i { display:block; height:100%; background:var(--accent); border-radius:2px; }
.dash .sep { width:1px; height:2.4rem; background:rgba(255,255,255,.09); flex:none; }
.dash canvas.trace { flex:1; min-width:0; height:2.5rem; display:block; }
.dash .bars { display:flex; gap:.22rem; height:2.5rem; flex:none; }
.dash .bar { width:.45rem; background:rgba(255,255,255,.08); border-radius:3px; position:relative; overflow:hidden; }
.dash .bar i { position:absolute; left:0; right:0; bottom:0; border-radius:3px; }
.dash .bar span { display:none; }
.dash .wheel { display:flex; align-items:center; justify-content:center; flex:none; }
.dash .wheel svg { width:2.9rem; height:2.9rem; overflow:visible; filter: drop-shadow(0 2px 3px rgba(0,0,0,.55)); }
.dash .foot { display:flex; justify-content:space-between; align-items:center; gap:.6rem; font-size:.85rem; flex:none; }
.dash .foot span { white-space:nowrap; }
.dash .foot b { font-weight:700; }
.dash .warn { display:flex; gap:.25rem; }
.dash .warn span { background:var(--red); color:#fff; font-size:.65rem; font-weight:700; padding:0 .3rem; border-radius:3px; }
.dash .warn span.lim { background:var(--yellow); color:#000; }
`);

Host.register('dash', function (root) {
  root.innerHTML = `<div class="dash">
    <div class="lights"></div>
    <div class="main">
      <div class="gearbox">
        <div class="gear">N</div>
        <div class="gcol">
          <div class="speed">0<small></small></div>
          <div class="rpmbar"><i></i></div>
          <div class="rpm">0<small>rpm</small></div>
        </div>
      </div>
      <div class="sep s1"></div>
      <canvas class="trace"></canvas>
      <div class="bars">
        <div class="bar b-cl"><i></i><span></span></div>
        <div class="bar b-br"><i></i><span></span></div>
        <div class="bar b-th"><i></i><span></span></div>
      </div>
      <div class="sep s2"></div>
      <div class="wheel">
        <svg viewBox="-50 -50 100 100">
          <defs>
            <linearGradient id="wRim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#f1f5f9"/><stop offset="1" stop-color="#94a3b8"/>
            </linearGradient>
            <linearGradient id="wGrip" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#3a4250"/><stop offset=".45" stop-color="#1c212b"/><stop offset="1" stop-color="#0e1117"/>
            </linearGradient>
            <linearGradient id="wHub" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#2a303c"/><stop offset="1" stop-color="#12151c"/>
            </linearGradient>
          </defs>
          <g class="rot">
            <!-- rim: top arc and flat bottom -->
            <path d="M-37 -14 C-37 -34 -20 -41 0 -41 C20 -41 37 -34 37 -14" fill="none" stroke="url(#wRim)" stroke-width="7" stroke-linecap="round"/>
            <path d="M-33 20 C-28 31 -16 33 0 33 C16 33 28 31 33 20" fill="none" stroke="url(#wRim)" stroke-width="7" stroke-linecap="round"/>
            <!-- grips -->
            <rect x="-47" y="-20" width="16" height="44" rx="8" fill="url(#wGrip)" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
            <rect x="31" y="-20" width="16" height="44" rx="8" fill="url(#wGrip)" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
            <!-- spokes -->
            <path d="M-31 2 L-15 2 M31 2 L15 2" stroke="#2a303c" stroke-width="7" stroke-linecap="round"/>
            <!-- hub with display and buttons -->
            <rect x="-16" y="-13" width="32" height="28" rx="7" fill="url(#wHub)" stroke="rgba(255,255,255,.16)" stroke-width="1"/>
            <rect x="-9" y="-8" width="18" height="9" rx="2" fill="#07090c" stroke="rgba(255,255,255,.08)" stroke-width=".8"/>
            <path d="M-6 -3.5 H6" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
            <circle cx="-10.5" cy="7.5" r="2.4" fill="#ef4444"/>
            <circle cx="-3.5" cy="8.5" r="2.4" fill="#facc15"/>
            <circle cx="3.5" cy="8.5" r="2.4" fill="#3b82f6"/>
            <circle cx="10.5" cy="7.5" r="2.4" fill="#22c55e"/>
            <!-- top center marker -->
            <rect x="-3.2" y="-45" width="6.4" height="8" rx="1.6" fill="var(--accent)"/>
          </g>
        </svg>
      </div>
    </div>
    <div class="foot"><div class="warn"></div><span class="info"></span></div>
  </div>`;
  const q = (s) => root.querySelector(s);
  const lightsEl = q('.lights');
  const canvas = q('canvas');
  const g = canvas.getContext('2d');
  const bars = { th: q('.b-th'), br: q('.b-br'), cl: q('.b-cl') };
  const rot = q('.rot');
  const samples = []; // { time, th, br, cl, st, abs }
  let lights = [];
  let lightCount = 0;
  let lastInfo = '', lastWarn = '';

  const WARN = [[0x01, 'WATER'], [0x02, 'FUEL P'], [0x04, 'OIL P'], [0x08, 'STALL'], [0x40, 'OIL T']];

  const slipEl = document.createElement('i');
  slipEl.className = 'slip';
  let slipKind = null, slipUntil = 0, slipShown = '';

  function buildLights(n) {
    lightCount = n;
    lightsEl.innerHTML = '<i></i>'.repeat(n);
    lights = [...lightsEl.children];
  }

  function placeSlip(s) {
    slipEl.remove();
    if (!s.slipLight) return;
    slipEl.className = 'slip ' + (s.slipSide === 'start' ? 'start' : 'end');
    if (s.slipSide === 'start') lightsEl.prepend(slipEl); else lightsEl.append(slipEl);
    // without shift lights, keep the slip light the size of one shift light
    slipEl.style.flex = s.shiftLights ? '' : `0 0 calc(100% / ${lightCount + 1})`;
  }

  function drawTrace(s) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) { g.beginPath(); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke(); }
    if (samples.length < 2) return;
    const now = samples[samples.length - 1].time;
    const X = (t) => w - ((now - t) / s.traceSeconds) * w;
    const pad = s.traceWidth;
    const Y = (v) => pad + (1 - v) * (h - pad * 2);
    g.lineWidth = s.traceWidth;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const line = (key, color, absColor) => {
      let cur = null;
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const col = absColor && p.abs ? absColor : color;
        if (col !== cur) {
          if (cur) g.stroke();
          g.beginPath();
          g.strokeStyle = col;
          cur = col;
          const prev = samples[Math.max(0, i - 1)];
          g.moveTo(X(prev.time), Y(prev[key]));
        }
        g.lineTo(X(p.time), Y(p[key]));
      }
      g.stroke();
    };
    if (s.showSteerTrace) line('st', s.steerColor);
    if (s.showClutch) line('cl', s.clutchColor);
    line('br', s.brakeColor, s.absColor);
    line('th', s.throttleColor);
  }

  function setBar(el, v, color) {
    const i = el.firstElementChild;
    i.style.height = (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%';
    i.style.background = color;
    el.lastElementChild.textContent = Math.round(v * 100);
  }

  const show = (el, on) => { el.style.display = on ? '' : 'none'; };

  return {
    configure(ctx) {
      const s = ctx.settings;
      if (s.lightCount !== lightCount) buildLights(s.lightCount);
      for (const el of lights) show(el, s.shiftLights);
      placeSlip(s);
      show(lightsEl, s.shiftLights || s.slipLight);
      show(q('.gearbox'), s.showGear);
      show(q('.rpmbar'), s.showRpmBar);
      show(canvas, s.showTrace);
      show(q('.bars'), s.showBars);
      show(bars.cl, s.showClutch);
      show(q('.wheel'), s.showSteering);
      show(q('.s1'), s.showGear && (s.showTrace || s.showBars || s.showSteering));
      show(q('.s2'), s.showSteering && (s.showTrace || s.showBars));
      show(q('.foot'), s.showLapInfo || s.showFuel || s.showBias || s.showWarnings);
      // with no trace, let the gear block take the free space
      q('.gearbox').style.flex = s.showTrace ? 'none' : '1';
    },
    update(state, ctx) {
      const s = ctx.settings, p = state.player, t = ctx.theme;
      if (!p) return;
      const u = state.session ? state.session.units : 'metric';

      // ---- gear / speed / rpm / shift lights ----
      const sh = p.shift || {};
      const red = sh.redline || 8000;
      const first = sh.slFirst || red * 0.75;
      const last = sh.slLast || sh.slShift || red * 0.95;
      const shiftAt = sh.slShift || last;
      const blink = sh.slBlink || red;
      if (s.showGear) {
        q('.gear').textContent = p.gear === -1 ? 'R' : p.gear === 0 ? 'N' : p.gear;
        q('.speed').firstChild.nodeValue = Math.round(Fmt.speed(p.speed, u));
        q('.speed small').textContent = Fmt.speedUnit(u);
        q('.rpm').firstChild.nodeValue = Math.round(p.rpm);
        if (s.showRpmBar) {
          const bar = q('.rpmbar i');
          bar.style.width = (Math.min(1, p.rpm / red) * 100).toFixed(1) + '%';
          bar.style.background = p.rpm >= shiftAt ? t.red : p.rpm >= first ? t.yellow : t.accent;
        }
      }
      if (s.shiftLights) {
        const on = p.rpm <= first ? 0 : Math.ceil(((p.rpm - first) / Math.max(1, last - first)) * lightCount);
        const blinkAll = p.rpm >= blink;
        lights.forEach((el, i) => {
          const f = i / lightCount;
          const col = blinkAll ? t.blue : f < 0.4 ? t.green : f < 0.75 ? t.yellow : t.red;
          const lit = i < on || blinkAll;
          el.style.background = lit ? col : '';
          el.style.boxShadow = lit ? `0 0 .5rem ${col}` : '';
        });
        lightsEl.classList.toggle('flash', s.flashOnShift && p.rpm >= shiftAt);
      }

      // ---- wheelspin / lock-up light ----
      if (s.slipLight) {
        const sl = p.slip;
        let kind = null;
        if (sl && sl.learned) {
          if (p.throttle > 0.1 && sl.dev > s.spinSensitivity / 100) kind = 'spin';
          else if (p.brake > 0.1 && sl.dev < -s.lockSensitivity / 100) kind = 'lock';
        }
        if (!kind && s.lockOnAbs && sl && sl.abs && p.brake > 0.05) kind = 'lock';
        const now = performance.now();
        if (kind) { slipKind = kind; slipUntil = now + 180; }
        const shown = now < slipUntil ? slipKind : '';
        if (shown !== slipShown) {
          slipShown = shown;
          const col = shown === 'spin' ? s.spinColor : shown === 'lock' ? s.lockColor : '';
          slipEl.style.background = col;
          slipEl.style.boxShadow = col ? `0 0 .5rem ${col}` : '';
          slipEl.title = shown === 'spin' ? 'Wheelspin' : shown === 'lock' ? 'Lock-up' : '';
        }
      }

      // ---- inputs ----
      const time = performance.now() / 1000;
      const half = p.steerMax / 2 || 4;
      samples.push({ time, th: p.throttle, br: p.brake, cl: p.clutch, st: 0.5 - Math.max(-1, Math.min(1, p.steer / half)) * 0.5, abs: p.abs });
      while (samples.length && time - samples[0].time > s.traceSeconds + 0.5) samples.shift();
      if (s.showTrace) drawTrace(s);
      if (s.showBars) {
        setBar(bars.th, p.throttle, s.throttleColor);
        setBar(bars.br, p.brake, p.abs ? s.absColor : s.brakeColor);
        setBar(bars.cl, p.clutch, s.clutchColor);
      }
      if (s.showSteering) rot.setAttribute('transform', `rotate(${(-p.steer * 180 / Math.PI).toFixed(1)})`);

      // ---- footer ----
      if (s.showWarnings) {
        const w = p.engineWarnings || 0;
        let html = (w & 0x10) ? '<span class="lim">PIT LIMITER</span>' : '';
        for (const [bit, label] of WARN) if (w & bit) html += `<span>${label}</span>`;
        if (html !== lastWarn) { q('.warn').innerHTML = html; lastWarn = html; }
      }
      const parts = [];
      if (s.showLapInfo) {
        const d = p.deltas && p.deltas.best;
        const delta = d && d[2] ? `<b class="${d[0] <= 0 ? 'green' : 'red'}">${Fmt.signed(d[0], 2)}</b>` : '<b class="dim">–</b>';
        const ses = state.session || {};
        const lapStr = ses.lapsTotal ? `${Math.max(0, p.lap)}/${ses.lapsTotal}` : Math.max(0, p.lap);
        parts.push(`Lap <b>${lapStr}</b>`, `Last <b>${Fmt.lapTime(p.lastLap)}</b>`, `Best <b>${Fmt.lapTime(p.bestLap)}</b>`, `Δ ${delta}`);
      }
      if (s.showFuel) parts.push(`Fuel <b>${Fmt.fuel(p.fuel, u, 1)} ${Fmt.fuelUnit(u)}</b>`);
      if (s.showBias && p.brakeBias) parts.push(`Bias <b>${p.brakeBias.toFixed(1)}%</b>`);
      const info = parts.map((x) => `<span>${x}</span>`).join('');
      if (info !== lastInfo) {
        const el = q('.info');
        el.innerHTML = info;
        el.style.display = 'flex';
        el.style.flex = '1';
        el.style.justifyContent = 'space-between';
        el.style.gap = '.6rem';
        lastInfo = info;
      }
    },
  };
});
