/*
 * Dashboard & Inputs: shift lights, gear/speed/RPM, pedal trace, pedal bars and
 * steering wheel in one overlay. Each block can be turned off in settings and
 * the remaining ones reflow.
 */
Host.css(`
.dash { position:absolute; inset:0; display:flex; flex-direction:column; padding:.35rem .5rem; gap:.3rem; }
.dash .lights { display:flex; gap:.3rem; justify-content:center; flex:none; }
.dash .lights i { flex:none; width:1rem; height:1rem; border-radius:50%; background:rgba(255,255,255,.08); }
.dash .lights.flash i { animation: dashflash .12s steps(2) infinite; }
@keyframes dashflash { 50% { opacity:.15 } }
.dash .main { display:flex; align-items:stretch; gap:.6rem; flex:1; min-height:0; }
.dash .gearbox { display:flex; align-items:center; gap:.6rem; flex:none; }
.dash .gear { font-size:3.2rem; font-weight:700; line-height:1; min-width:2.2rem; text-align:center; }
.dash .gcol { display:flex; flex-direction:column; justify-content:center; gap:.15rem; width:6.5rem; }
.dash .speed { font-size:1.6rem; font-weight:700; line-height:1; }
.dash .speed small, .dash .rpm small { font-size:.7rem; color:var(--dim); margin-left:.2rem; }
.dash .rpm { font-size:.85rem; color:var(--dim); }
.dash .rpmbar { height:.4rem; background:rgba(255,255,255,.08); border-radius:3px; overflow:hidden; }
.dash .rpmbar i { display:block; height:100%; background:var(--accent); border-radius:3px; }
.dash canvas.trace { flex:1; min-width:0; height:100%; display:block; }
.dash .bars { display:flex; gap:.25rem; align-items:stretch; flex:none; }
.dash .bar { width:1.1rem; background:rgba(255,255,255,.08); border-radius:3px; position:relative; overflow:hidden; }
.dash .bar i { position:absolute; left:0; right:0; bottom:0; border-radius:3px; }
.dash .bar span { position:absolute; left:0; right:0; bottom:.1rem; text-align:center; font-size:.6rem; font-weight:700; color:#fff; text-shadow:0 0 2px #000; }
.dash .wheel { display:flex; align-items:center; justify-content:center; flex:none; }
.dash .wheel svg { width:3.4rem; height:3.4rem; }
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
      <canvas class="trace"></canvas>
      <div class="bars">
        <div class="bar b-cl"><i></i><span></span></div>
        <div class="bar b-br"><i></i><span></span></div>
        <div class="bar b-th"><i></i><span></span></div>
      </div>
      <div class="wheel">
        <svg viewBox="-50 -50 100 100"><g class="rot">
          <circle r="40" fill="none" stroke="currentColor" stroke-width="9" opacity=".9"/>
          <path d="M-38 4 L-12 10 L12 10 L38 4" fill="none" stroke="currentColor" stroke-width="9"/>
          <path d="M0 10 L0 40" stroke="currentColor" stroke-width="9"/>
          <rect x="-4" y="-49" width="8" height="12" fill="var(--accent)"/>
        </g></svg>
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

  function buildLights(n) {
    lightCount = n;
    lightsEl.innerHTML = '<i></i>'.repeat(n);
    lights = [...lightsEl.children];
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
      show(lightsEl, s.shiftLights);
      show(q('.gearbox'), s.showGear);
      show(q('.rpmbar'), s.showRpmBar);
      show(canvas, s.showTrace);
      show(q('.bars'), s.showBars);
      show(bars.cl, s.showClutch);
      show(q('.wheel'), s.showSteering);
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
