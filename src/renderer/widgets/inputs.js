Host.css(`
.inp { position:absolute; inset:0; display:flex; gap:.5rem; padding:.4rem; align-items:stretch; }
.inp canvas.trace { flex:1; min-width:0; height:100%; display:block; }
.inp .bars { display:flex; gap:.25rem; align-items:stretch; }
.inp .bar { width:1.1rem; background:rgba(255,255,255,.08); border-radius:3px; position:relative; overflow:hidden; }
.inp .bar i { position:absolute; left:0; right:0; bottom:0; border-radius:3px; }
.inp .bar span { position:absolute; left:0; right:0; bottom:.1rem; text-align:center; font-size:.6rem; font-weight:700; color:#fff; text-shadow:0 0 2px #000; }
.inp .wheel { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:4.2rem; gap:.1rem; }
.inp .wheel svg { width:3.4rem; height:3.4rem; }
.inp .gear { font-size:1.9rem; font-weight:700; line-height:1; }
.inp .spd { font-size:.8rem; color:var(--dim); font-weight:600; }
`);

Host.register('inputs', function (root) {
  root.innerHTML = `<div class="inp">
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
      <div class="gear"></div><div class="spd"></div>
    </div>
  </div>`;
  const q = (s) => root.querySelector(s);
  const canvas = q('canvas');
  const g = canvas.getContext('2d');
  const bars = { th: q('.b-th'), br: q('.b-br'), cl: q('.b-cl') };
  const rot = q('.rot');
  const samples = []; // { time, th, br, cl, st, abs }

  function drawTrace(s) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
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

  return {
    configure(ctx) {
      const s = ctx.settings;
      canvas.style.display = s.showTrace ? '' : 'none';
      q('.bars').style.display = s.showBars ? '' : 'none';
      bars.cl.style.display = s.showClutch ? '' : 'none';
      q('.wheel').style.display = s.showSteering || s.showGearSpeed ? '' : 'none';
      q('.wheel svg').style.display = s.showSteering ? '' : 'none';
      q('.gear').style.display = q('.spd').style.display = s.showGearSpeed ? '' : 'none';
    },
    update(state, ctx) {
      const s = ctx.settings;
      const p = state.player;
      if (!p) return;
      const time = performance.now() / 1000;
      const half = p.steerMax / 2 || 4;
      const st = 0.5 - Math.max(-1, Math.min(1, p.steer / half)) * 0.5;
      samples.push({ time, th: p.throttle, br: p.brake, cl: p.clutch, st, abs: p.abs });
      while (samples.length && time - samples[0].time > s.traceSeconds + 0.5) samples.shift();
      if (s.showTrace) drawTrace(s);
      if (s.showBars) {
        setBar(bars.th, p.throttle, s.throttleColor);
        setBar(bars.br, p.brake, p.abs ? s.absColor : s.brakeColor);
        setBar(bars.cl, p.clutch, s.clutchColor);
      }
      if (s.showSteering) rot.setAttribute('transform', `rotate(${(-p.steer * 180 / Math.PI).toFixed(1)})`);
      if (s.showGearSpeed) {
        q('.gear').textContent = p.gear === -1 ? 'R' : p.gear === 0 ? 'N' : p.gear;
        const u = state.session ? state.session.units : 'metric';
        q('.spd').textContent = `${Math.round(Fmt.speed(p.speed, u))} ${Fmt.speedUnit(u)}`;
      }
    },
  };
});
