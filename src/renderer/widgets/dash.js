/*
 * Dashboard & Inputs: shift lights, gear/speed/RPM, pedal trace, pedal bars and
 * steering wheel in one overlay. Each block can be turned off in settings and
 * the remaining ones reflow.
 */
Host.css(`
.dash { position:absolute; inset:0; display:flex; flex-direction:row; align-items:stretch; padding:var(--padv, 4px) .6rem; gap:.6rem; overflow:hidden; }
.dash .col { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; gap:.22rem; }
.dash .sep.tall { height:auto; align-self:stretch; margin:.3rem 0; }
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
.dash .wheel { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.1rem; flex:none; align-self:center; overflow:visible; }
.dash .wheel.smooth .steerbar .fill, .dash .wheel.smooth .steerbar .knob { transition:all 70ms linear; }
.dash .wheel svg.steerbar { flex:none; width:6rem; height:1.4rem; aspect-ratio:auto; filter:none; }
.dash .wheel .ang { font-size:.75rem; font-weight:700; color:var(--dim); white-space:nowrap; line-height:1; flex:none; }
.dash .wheel svg { flex:none; height:var(--wheel, 3rem); width:var(--wheel, 3rem); overflow:visible; filter: drop-shadow(0 2px 3px rgba(0,0,0,.55)); }
.dash .foot { display:flex; justify-content:space-between; align-items:center; gap:.6rem; font-size:.85rem; line-height:1.15; flex:none; }
.dash .foot span { white-space:nowrap; }
.dash .foot b { font-weight:700; }
.dash .warn { display:flex; gap:.25rem; }
.dash .warn span { background:var(--red); color:#fff; font-size:.65rem; font-weight:700; padding:0 .3rem; border-radius:3px; }
.dash .warn span.lim { background:var(--yellow); color:#000; }
`);

Host.register('dash', function (root) {
  root.innerHTML = `<div class="dash"><div class="col">
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
    </div>
    <div class="foot"><div class="warn"></div><span class="info"></span></div>
  </div><div class="sep s2 tall"></div><div class="wheel"></div></div>`;
  const q = (s) => root.querySelector(s);
  const lightsEl = q('.lights');
  const canvas = q('canvas');
  const g = canvas.getContext('2d');
  const bars = { th: q('.b-th'), br: q('.b-br'), cl: q('.b-cl') };
  let rot = null, bar = null, wheelStyle = '', lastAng = '';
  // Wheel rotation uses the SVG transform attribute, which always rotates around the
  // viewBox origin (the wheel's center). Smoothing runs per display frame.
  let steerTarget = 0, steerShown = 0, smoothOn = true, rafOn = false;
  function steerFrame() {
    rafOn = false;
    if (!rot) return;
    steerShown = smoothOn ? steerShown + (steerTarget - steerShown) * 0.45 : steerTarget;
    if (Math.abs(steerTarget - steerShown) < 0.05) steerShown = steerTarget;
    rot.setAttribute('transform', `rotate(${steerShown.toFixed(2)})`);
    if (steerShown !== steerTarget) { rafOn = true; requestAnimationFrame(steerFrame); }
  }
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

  // Wheel size = height of the visible content in the left column.
  function contentHeight() {
    const col = q('.col');
    const kids = [...col.children].filter((c) => c.offsetParent !== null);
    let h = parseFloat(getComputedStyle(col).rowGap || 0) * Math.max(0, kids.length - 1);
    for (const c of kids) h += c.getBoundingClientRect().height;
    return h;
  }
  let wheelPx = 0;
  let ctxSettings = null;
  function sizeWheel() {
    const h = Math.round(contentHeight());
    if (h > 0 && h !== wheelPx) { wheelPx = h; q('.wheel').style.setProperty('--wheel', h + 'px'); }
  }
  window.addEventListener('resize', () => requestAnimationFrame(sizeWheel));

  return {
    // Natural size in rem, measured from the visible blocks, so the contents can
    // scale to fill the window exactly (see Host.applyFontSize).
    fit() {
      const el = root.querySelector('.col');
      const cs = getComputedStyle(root.firstElementChild);
      const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
      const kids = [...el.children].filter((c) => c.offsetParent !== null);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom); // px, does not scale
      let h = parseFloat(getComputedStyle(el).rowGap || 0) * Math.max(0, kids.length - 1);
      for (const c of kids) h += c.getBoundingClientRect().height;
      const wheelW = q('.wheel').offsetParent !== null ? contentHeight() / fs + 1.4 : 0; // square wheel + divider + gaps
      return { w: 38 + wheelW, h: h / fs, padPx: pad, fitHeight: ctxSettings && ctxSettings.fitHeight !== false };
    },
    configure(ctx) {
      const s = ctx.settings;
      ctxSettings = s;
      root.firstElementChild.style.setProperty('--padv', (s.padV ?? 4) + 'px');
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
      const style = s.wheelStyle || 'gt';
      if (style !== wheelStyle) {
        wheelStyle = style;
        q('.wheel').innerHTML = Wheels.svg(style) + '<span class="ang"></span>';
        rot = q('.wheel .rot');
        bar = style === 'bar' ? { fill: q('.steerbar .fill'), knob: q('.steerbar .knob') } : null;
        lastAng = '';
      }
      q('.wheel').classList.toggle('smooth', s.smoothSteering !== false);
      show(q('.wheel .ang'), !!s.showSteerAngle);
      requestAnimationFrame(sizeWheel);
      show(q('.s1'), s.showGear && (s.showTrace || s.showBars || s.showSteering));
      show(q('.s2'), s.showSteering);
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
      if (s.showSteering) {
        const deg = (-p.steer * 180) / Math.PI; // iRacing: positive = left; screen: positive = clockwise
        if (bar) {
          const f = Math.max(-1, Math.min(1, -p.steer / (p.steerMax / 2 || 4)));
          bar.knob.setAttribute('cx', (f * 43).toFixed(1));
          bar.fill.setAttribute('x', Math.min(0, f * 43).toFixed(1));
          bar.fill.setAttribute('width', Math.abs(f * 43).toFixed(1));
        } else if (rot) {
          steerTarget = deg;
          smoothOn = s.smoothSteering !== false;
          if (!rafOn) { rafOn = true; requestAnimationFrame(steerFrame); }
        }
        if (s.showSteerAngle) {
          const a = Math.round(deg);
          const txt = a === 0 ? '0°' : `${a < 0 ? '◀' : '▶'} ${Math.abs(a)}°`;
          if (txt !== lastAng) { q('.wheel .ang').textContent = txt; lastAng = txt; }
        }
      }

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
        requestAnimationFrame(sizeWheel);
      }
    },
  };
});
